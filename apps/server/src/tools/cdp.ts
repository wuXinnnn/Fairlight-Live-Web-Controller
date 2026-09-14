/**
 * A Chrome DevTools Protocol client small enough to own.
 *
 * The soak driver needs four things from a browser: heap and DOM counters, a way to read the page,
 * a way to press a key, and a way to make it collect garbage first. That is a handful of CDP calls
 * over one WebSocket, which Node has had built in since 22 — far less than a browser automation
 * library would bring with it, and this project adds no dependency it does not need.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/** How long Chrome is given to print its debugging address before the launch is abandoned. */
export const SOAK_BROWSER_LAUNCH_TIMEOUT_MS = 15_000;

type CdpListener = (params: Record<string, unknown>) => void;

export interface CdpConnection {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: CdpListener): void;
  close(): void;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

/** A socket that is never coming back answers every call, rather than leaving the driver hanging. */
const CLOSED_MESSAGE = 'the CDP connection is closed';

export function connectCdp(
  webSocketUrl: string,
  options: { WebSocket?: typeof WebSocket } = {},
): Promise<CdpConnection> {
  const WebSocketImpl = options.WebSocket ?? WebSocket;
  const socket = new WebSocketImpl(webSocketUrl);
  const pending = new Map<number, { resolve(value: never): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<CdpListener>>();
  let nextId = 0;
  let closed: Error | undefined;

  const failPending = (error: Error): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener('message', (event: MessageEvent) => {
    let message: CdpMessage;
    try {
      message = JSON.parse(String(event.data)) as CdpMessage;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const entry = pending.get(message.id);
      if (entry === undefined) {
        // A response to a call nobody is waiting for any more. Dropping it is the whole handling.
        return;
      }
      pending.delete(message.id);
      if (message.error !== undefined) {
        entry.reject(
          new Error(`${message.error.message ?? 'CDP call failed'} (${message.error.code ?? 0})`),
        );
        return;
      }
      entry.resolve((message.result ?? {}) as never);
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    }
  });

  socket.addEventListener('close', () => {
    closed ??= new Error(CLOSED_MESSAGE);
    failPending(closed);
  });

  const connection: CdpConnection = {
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (closed !== undefined) {
        return Promise.reject(closed);
      }
      const id = (nextId += 1);
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (value: never) => void,
          reject: (error) => reject(new Error(`${method}: ${error.message}`)),
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(event, listener) {
      const existing = listeners.get(event) ?? new Set<CdpListener>();
      existing.add(listener);
      listeners.set(event, existing);
    },
    close() {
      closed ??= new Error(CLOSED_MESSAGE);
      failPending(closed);
      socket.close();
    },
  };

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(connection));
    socket.addEventListener('error', () => {
      reject(new Error(`could not open a CDP connection to ${webSocketUrl}`));
    });
  });
}

/**
 * The one line Chrome prints to stderr once its debugging port is up.
 *
 * The newline is part of the pattern on purpose. A pipe may hand over `…on ws://127.0.0` and the
 * rest a moment later, and without it the address would be read as complete halfway through and
 * every later call would go to a host that does not exist.
 */
export function parseDevToolsUrl(text: string): string | undefined {
  return /DevTools listening on (ws:\/\/\S+)\r?\n/.exec(text)?.[1];
}

/** `ws://127.0.0.1:1234/devtools/browser/x` to `http://127.0.0.1:1234`. */
export function devToolsHttpBase(webSocketUrl: string): string {
  const url = new URL(webSocketUrl);
  return `http://${url.host}`;
}

export interface ChromeLookupEnv {
  CHROME_PATH?: string;
  CHROME_BIN?: string;
  LOCALAPPDATA?: string;
}

export function chromeCandidates(platform: NodeJS.Platform, env: ChromeLookupEnv): string[] {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ...(localAppData === undefined
        ? []
        : [`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`]),
      'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
    ];
  }
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  // Absolute paths, because these are checked with `existsSync` and a bare command name would
  // never be found by it however well it would have worked as something to run.
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

/**
 * The explicit path and the two environment variables are trusted without probing: CI sets
 * `CHROME_BIN` and what it names is the browser whether or not this process can stat it. Only the
 * platform guesses are checked, because a guess that is wrong should fall through to the next one.
 */
export function resolveChromeExecutable(
  explicit?: string,
  env: ChromeLookupEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (candidate: string) => boolean = existsSync,
): string {
  const named = explicit ?? env.CHROME_PATH ?? env.CHROME_BIN;
  if (named !== undefined && named !== '') {
    return named;
  }
  for (const candidate of chromeCandidates(platform, env)) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  throw new Error('Chrome was not found. Pass --browser <path>, or set CHROME_PATH or CHROME_BIN.');
}

export interface LaunchChromeOptions {
  executable: string;
  url: string;
  userDataDir: string;
  args?: string[];
  launchTimeoutMs?: number;
  spawn?: typeof nodeSpawn;
  fetch?: typeof globalThis.fetch;
}

export interface LaunchedChrome {
  pageSocketUrl: string;
  kill(): void;
}

interface DevToolsTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

export async function launchChrome(options: LaunchChromeOptions): Promise<LaunchedChrome> {
  const spawnImpl = options.spawn ?? nodeSpawn;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.launchTimeoutMs ?? SOAK_BROWSER_LAUNCH_TIMEOUT_MS;
  const child: ChildProcess = spawnImpl(
    options.executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${options.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1920,1080',
      // Caller arguments come before the URL: Chrome reads the first non-flag argument as the page
      // to open, so a flag after it would be taken for a second page instead of a setting.
      ...(options.args ?? []),
      options.url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const browserSocketUrl = await new Promise<string>((resolve, reject) => {
    // Chrome prints its address in one write, but a pipe is free to split it, so the whole of
    // stderr is matched rather than each chunk.
    let buffered = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${options.executable} did not report a DevTools address within ${timeoutMs}ms ` +
            `(SOAK_BROWSER_LAUNCH_TIMEOUT_MS)`,
        ),
      );
    }, timeoutMs);
    const settle = (outcome: () => void): void => {
      clearTimeout(timer);
      outcome();
    };
    child.stderr?.on('data', (chunk: Buffer | string) => {
      buffered += String(chunk);
      const found = parseDevToolsUrl(buffered);
      if (found !== undefined) {
        settle(() => resolve(found));
      }
    });
    child.on('error', (error: Error) => settle(() => reject(error)));
    child.on('exit', (code) => {
      settle(() => reject(new Error(`${options.executable} exited with code ${code ?? 0}`)));
    });
  });

  const response = await fetchImpl(`${devToolsHttpBase(browserSocketUrl)}/json/list`);
  const targets = (await response.json()) as DevToolsTarget[];
  const page = targets.find(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (page?.webSocketDebuggerUrl === undefined) {
    child.kill();
    throw new Error('Chrome started but opened no page to attach to');
  }

  return {
    pageSocketUrl: page.webSocketDebuggerUrl,
    kill() {
      child.kill();
      /*
       * The stderr pipe keeps a handle open for as long as anyone is listening to it, and a Node
       * process does not exit while one is live. Nothing is read from it after the address has
       * been found, so it is let go of here rather than holding the run open after its report is
       * already written.
       */
      child.stderr?.removeAllListeners();
      child.stderr?.destroy();
      child.unref();
    },
  };
}
