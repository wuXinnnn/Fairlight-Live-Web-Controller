import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  chromeCandidates,
  connectCdp,
  devToolsHttpBase,
  launchChrome,
  parseDevToolsUrl,
  resolveChromeExecutable,
  type CdpConnection,
} from './cdp.js';

/** A WebSocket whose open, message and close are driven by the test rather than by a network. */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  open(): void {
    this.dispatchEvent(new Event('open'));
  }

  deliver(payload: unknown): void {
    const event = new Event('message') as Event & { data: string };
    event.data = JSON.stringify(payload);
    this.dispatchEvent(event);
  }

  fail(): void {
    this.dispatchEvent(new Event('error'));
  }
}

async function openConnection(): Promise<{ connection: CdpConnection; socket: FakeWebSocket }> {
  FakeWebSocket.instances = [];
  const pending = connectCdp('ws://127.0.0.1:1/devtools/page/a', {
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
  });
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) {
    throw new Error('no socket was constructed');
  }
  socket.open();
  return { connection: await pending, socket };
}

function sentIds(socket: FakeWebSocket): number[] {
  return socket.sent.map((raw) => (JSON.parse(raw) as { id: number }).id);
}

describe('connectCdp', () => {
  it('matches each response to the call that is waiting for it', async () => {
    const { connection, socket } = await openConnection();
    const first = connection.send('Performance.getMetrics');
    const second = connection.send('Runtime.evaluate', { expression: '1' });

    const [firstId, secondId] = sentIds(socket);
    expect(firstId).not.toBe(secondId);
    // Answered out of order, which the protocol allows and an id is the only defence against.
    socket.deliver({ id: secondId, result: { value: 'second' } });
    socket.deliver({ id: firstId, result: { value: 'first' } });

    await expect(first).resolves.toEqual({ value: 'first' });
    await expect(second).resolves.toEqual({ value: 'second' });
  });

  it('turns a protocol error into a rejection that names the call', async () => {
    const { connection, socket } = await openConnection();
    const call = connection.send('Runtime.evaluate');
    socket.deliver({
      id: sentIds(socket)[0],
      error: { code: -32000, message: 'Cannot find context' },
    });
    await expect(call).rejects.toThrow('Runtime.evaluate: Cannot find context (-32000)');
  });

  it('resolves with an empty result when a call returns nothing', async () => {
    const { connection, socket } = await openConnection();
    const call = connection.send('HeapProfiler.collectGarbage');
    socket.deliver({ id: sentIds(socket)[0] });
    await expect(call).resolves.toEqual({});
  });

  it('delivers an event to every listener registered for it', async () => {
    const { connection, socket } = await openConnection();
    const first = vi.fn();
    const second = vi.fn();
    connection.on('Page.loadEventFired', first);
    connection.on('Page.loadEventFired', second);

    socket.deliver({ method: 'Page.loadEventFired', params: { timestamp: 7 } });

    expect(first).toHaveBeenCalledWith({ timestamp: 7 });
    expect(second).toHaveBeenCalledWith({ timestamp: 7 });
  });

  it('ignores an event nobody listens for and a response nobody waits for', async () => {
    const { connection, socket } = await openConnection();
    expect(() => socket.deliver({ method: 'Page.unheard', params: {} })).not.toThrow();
    expect(() => socket.deliver({ id: 4321, result: {} })).not.toThrow();
    expect(() => socket.deliver({ method: 'Page.unheard' })).not.toThrow();
    // Still usable afterwards.
    const call = connection.send('Runtime.evaluate');
    socket.deliver({ id: sentIds(socket)[0], result: { ok: true } });
    await expect(call).resolves.toEqual({ ok: true });
  });

  it('survives a message that is not JSON', async () => {
    const { socket } = await openConnection();
    const event = new Event('message') as Event & { data: string };
    event.data = 'not json';
    expect(() => socket.dispatchEvent(event)).not.toThrow();
  });

  it('rejects everything in flight when it is closed, and everything after', async () => {
    const { connection, socket } = await openConnection();
    const call = connection.send('Performance.getMetrics');

    connection.close();

    await expect(call).rejects.toThrow('the CDP connection is closed');
    expect(socket.closed).toBe(true);
    await expect(connection.send('Runtime.evaluate')).rejects.toThrow(
      'the CDP connection is closed',
    );
  });

  it('rejects everything in flight when the browser closes the socket', async () => {
    const { connection, socket } = await openConnection();
    const call = connection.send('Performance.getMetrics');
    socket.close();
    await expect(call).rejects.toThrow('the CDP connection is closed');
  });

  it('rejects when the socket never opens', async () => {
    FakeWebSocket.instances = [];
    const pending = connectCdp('ws://127.0.0.1:1/devtools/page/a', {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
    });
    FakeWebSocket.instances[0]?.fail();
    await expect(pending).rejects.toThrow('could not open a CDP connection');
  });
});

describe('parseDevToolsUrl', () => {
  it('finds the address Chrome prints', () => {
    expect(
      parseDevToolsUrl('DevTools listening on ws://127.0.0.1:52301/devtools/browser/abc\n'),
    ).toBe('ws://127.0.0.1:52301/devtools/browser/abc');
  });

  it('waits for the end of the line rather than reading a half-written address', () => {
    // What a pipe hands over when it splits the line; the rest has not arrived yet.
    expect(parseDevToolsUrl('DevTools listening on ws://127.0.0')).toBeUndefined();
  });

  it('finds it among the other lines Chrome writes', () => {
    const noise = [
      '[0915/023000.123:WARNING:bluetooth_adapter_winrt.cc(1177)] ignoring',
      'DevTools listening on ws://127.0.0.1:1/devtools/browser/x',
      'more noise',
    ].join('\n');
    expect(parseDevToolsUrl(noise)).toBe('ws://127.0.0.1:1/devtools/browser/x');
  });

  it('returns nothing when the line has not arrived', () => {
    expect(parseDevToolsUrl('DevTools listening on ')).toBeUndefined();
    expect(parseDevToolsUrl('')).toBeUndefined();
  });
});

describe('devToolsHttpBase', () => {
  it('keeps the host and drops the path', () => {
    expect(devToolsHttpBase('ws://127.0.0.1:52301/devtools/browser/abc')).toBe(
      'http://127.0.0.1:52301',
    );
  });
});

describe('chromeCandidates', () => {
  it('lists the Windows install locations, stable first', () => {
    const candidates = chromeCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' });
    expect(candidates[0]).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain(
      'C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    );
    expect(candidates.at(-1)).toContain('Chrome Beta');
  });

  it('omits the per-user location when there is no LOCALAPPDATA', () => {
    expect(chromeCandidates('win32', {}).some((path) => path.includes('AppData'))).toBe(false);
  });

  it('lists absolute paths on linux, because bare names are never found on disk', () => {
    expect(chromeCandidates('linux', {}).every((path) => path.startsWith('/usr/bin/'))).toBe(true);
  });

  it('lists the bundle path on darwin', () => {
    expect(chromeCandidates('darwin', {})).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  });
});

describe('resolveChromeExecutable', () => {
  const never = (): boolean => false;
  const always = (): boolean => true;

  it('prefers what the caller passed over everything else', () => {
    expect(
      resolveChromeExecutable(
        'D:\\chrome.exe',
        { CHROME_PATH: 'x', CHROME_BIN: 'y' },
        'win32',
        always,
      ),
    ).toBe('D:\\chrome.exe');
  });

  it('prefers CHROME_PATH over CHROME_BIN', () => {
    expect(
      resolveChromeExecutable(undefined, { CHROME_PATH: 'a', CHROME_BIN: 'b' }, 'linux', always),
    ).toBe('a');
  });

  it('takes CHROME_BIN without checking it exists, because CI names one that does', () => {
    expect(resolveChromeExecutable(undefined, { CHROME_BIN: 'chrome' }, 'linux', never)).toBe(
      'chrome',
    );
  });

  it('falls past a platform candidate that is not installed', () => {
    const installed = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    expect(
      resolveChromeExecutable(undefined, {}, 'win32', (candidate) => candidate === installed),
    ).toBe(installed);
  });

  it('ignores an empty string the way it ignores an absent value', () => {
    const installed = '/usr/bin/chromium';
    expect(
      resolveChromeExecutable(
        '',
        { CHROME_PATH: '' },
        'linux',
        (candidate) => candidate === installed,
      ),
    ).toBe(installed);
  });

  it('explains how to point it at a browser when it finds none', () => {
    expect(() => resolveChromeExecutable(undefined, {}, 'linux', never)).toThrow(/--browser/);
  });
});

/** A child process whose stderr and lifetime the test drives. Chrome itself is never started. */
function fakeChild(): ChildProcess & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  const stderr = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  stderr.destroy = vi.fn();
  child.stderr = stderr;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child as unknown as ChildProcess & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
}

type ChildProcess = import('node:child_process').ChildProcess;

describe('launchChrome', () => {
  const listUrl = 'http://127.0.0.1:9/json/list';

  function jsonResponse(body: unknown): Response {
    return { json: async () => body } as Response;
  }

  it('reads an address that arrives split across writes and attaches to the page', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        { type: 'background_page', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/bg' },
        { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/real' },
      ]),
    );

    const pending = launchChrome({
      executable: 'chrome',
      url: 'http://127.0.0.1:1234/',
      userDataDir: '/tmp/profile',
      args: ['--no-sandbox'],
      spawn: spawn as never,
      fetch: fetchImpl as never,
    });

    child.stderr.emit('data', 'DevTools listening on ws://127.0.0');
    child.stderr.emit('data', '.1:9/devtools/browser/abc\n');

    await expect(pending).resolves.toMatchObject({
      pageSocketUrl: 'ws://127.0.0.1:9/devtools/page/real',
    });
    expect(fetchImpl).toHaveBeenCalledWith(listUrl);

    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args[0]).toBe('--headless=new');
    expect(args).toContain('--user-data-dir=/tmp/profile');
    // The page to open is last, so a caller argument cannot be mistaken for a second page.
    expect(args.at(-1)).toBe('http://127.0.0.1:1234/');
    expect(args.indexOf('--no-sandbox')).toBeLessThan(args.length - 1);
  });

  it('gives up when Chrome never reports an address', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const pending = launchChrome({
        executable: 'chrome',
        url: 'http://127.0.0.1:1234/',
        userDataDir: '/tmp/profile',
        launchTimeoutMs: 1000,
        spawn: vi.fn(() => child) as never,
        fetch: vi.fn() as never,
      });
      const assertion = expect(pending).rejects.toThrow(/SOAK_BROWSER_LAUNCH_TIMEOUT_MS/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a browser that fails to start at all', async () => {
    const child = fakeChild();
    const pending = launchChrome({
      executable: 'chrome',
      url: 'http://127.0.0.1:1234/',
      userDataDir: '/tmp/profile',
      spawn: vi.fn(() => child) as never,
      fetch: vi.fn() as never,
    });
    child.emit('error', new Error('spawn ENOENT'));
    await expect(pending).rejects.toThrow('spawn ENOENT');
  });

  it('reports a browser that exits before it is ready', async () => {
    const child = fakeChild();
    const pending = launchChrome({
      executable: 'chrome',
      url: 'http://127.0.0.1:1234/',
      userDataDir: '/tmp/profile',
      spawn: vi.fn(() => child) as never,
      fetch: vi.fn() as never,
    });
    child.emit('exit', 3);
    await expect(pending).rejects.toThrow('exited with code 3');
  });

  it('stops a browser that opened no page to attach to', async () => {
    const child = fakeChild();
    const pending = launchChrome({
      executable: 'chrome',
      url: 'http://127.0.0.1:1234/',
      userDataDir: '/tmp/profile',
      spawn: vi.fn(() => child) as never,
      fetch: vi.fn(async () => jsonResponse([{ type: 'background_page' }])) as never,
    });
    child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1:9/devtools/browser/abc\n');
    await expect(pending).rejects.toThrow('opened no page');
    expect(child.kill).toHaveBeenCalled();
  });

  it('kills the process it started', async () => {
    const child = fakeChild();
    const pending = launchChrome({
      executable: 'chrome',
      url: 'http://127.0.0.1:1234/',
      userDataDir: '/tmp/profile',
      spawn: vi.fn(() => child) as never,
      fetch: vi.fn(async () =>
        jsonResponse([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/a' }]),
      ) as never,
    });
    child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1:9/devtools/browser/abc\n');
    const chrome = await pending;
    chrome.kill();
    expect(child.kill).toHaveBeenCalled();
    // The stderr pipe is let go of too: a live one would keep the run's process from exiting.
    const stderr = child.stderr as unknown as { destroy: ReturnType<typeof vi.fn> };
    expect(stderr.destroy).toHaveBeenCalled();
  });
});
