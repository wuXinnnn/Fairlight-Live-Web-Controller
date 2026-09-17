import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { AppLogger } from './logger.js';
import type { ShutdownProcess, ShutdownTarget, TimerHandle } from './shutdown.js';
import {
  EXIT_ON_STDIN_CLOSE_ENV,
  SHUTDOWN_FORCED_EXIT_CODE,
  SHUTDOWN_SIGNALS,
  SHUTDOWN_TIMEOUT_MS,
  installShutdownHandlers,
  shouldWatchStdin,
  watchStdinForExit,
} from './shutdown.js';

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  obj: object;
  msg: string;
}

/** A logger that keeps what it was told, so the tests can tell the two exit-1 paths apart. */
function recordingLogger(): AppLogger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    debug: (obj, msg) => lines.push({ level: 'debug', obj, msg }),
    info: (obj, msg) => lines.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj, msg }),
  };
}

interface FakeProcess extends ShutdownProcess {
  readonly exits: number[];
  signals(): string[];
  emit(event: string): void;
}

function fakeProcess(): FakeProcess {
  const listeners = new Map<string, (() => void)[]>();
  const exits: number[] = [];
  return {
    exits,
    signals: () => [...listeners.keys()],
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    // A real `exit` never returns; recording one keeps the losing branch of the race observable.
    exit(code) {
      exits.push(code);
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
  };
}

interface Scheduled {
  handler: () => void;
  ms: number;
  handle: number;
}

interface FakeClock {
  scheduled: Scheduled[];
  cleared: TimerHandle[];
  setTimeout: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  fireLast: () => void;
}

/**
 * Injected timers rather than `vi.useFakeTimers()`: the handle handed to `clearTimeout` is what
 * proves the deadline was called off, and faking the global timers would also fake the
 * `setImmediate` these tests use to let `close()` settle.
 */
function fakeClock(): FakeClock {
  const scheduled: Scheduled[] = [];
  const cleared: TimerHandle[] = [];
  let next = 1;
  return {
    scheduled,
    cleared,
    setTimeout: (handler, ms) => {
      const handle = next++;
      scheduled.push({ handler, ms, handle });
      return handle;
    },
    clearTimeout: (handle) => {
      cleared.push(handle);
    },
    fireLast: () => {
      scheduled.at(-1)?.handler();
    },
  };
}

/** Lets the `close()` promise and the async wrapper around it settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function targetThat(close: () => Promise<unknown>): ShutdownTarget {
  return { close };
}

describe('installShutdownHandlers', () => {
  it('closes the target and exits zero', async () => {
    const proc = fakeProcess();
    const clock = fakeClock();
    const logger = recordingLogger();
    let closed = 0;

    installShutdownHandlers(
      targetThat(async () => {
        closed += 1;
      }),
      { logger, process: proc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    );

    proc.emit('SIGINT');
    await flush();

    expect(closed).toBe(1);
    expect(proc.exits).toEqual([0]);
    expect(clock.scheduled[0]?.ms).toBe(SHUTDOWN_TIMEOUT_MS);
    expect(clock.cleared).toEqual([clock.scheduled[0]?.handle]);
    expect(logger.lines.map((line) => line.msg)).toEqual(['shutting down', 'shutdown complete']);
  });

  it('exits one when the close hangs past the timeout', async () => {
    const proc = fakeProcess();
    const clock = fakeClock();
    const logger = recordingLogger();

    installShutdownHandlers(
      targetThat(() => new Promise(() => {})),
      {
        logger,
        process: proc,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        timeoutMs: 1234,
      },
    );

    proc.emit('SIGTERM');
    await flush();
    expect(proc.exits).toEqual([]);

    clock.fireLast();
    expect(proc.exits).toEqual([1]);
    expect(clock.cleared).toEqual([]);
    expect(logger.lines.at(-1)).toMatchObject({
      level: 'error',
      msg: 'shutdown timed out, exiting',
      obj: { timeoutMs: 1234 },
    });
  });

  it('exits one and says why when the close throws', async () => {
    const proc = fakeProcess();
    const clock = fakeClock();
    const logger = recordingLogger();

    installShutdownHandlers(
      targetThat(() => Promise.reject(new Error('socket stuck'))),
      { logger, process: proc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    );

    proc.emit('SIGINT');
    await flush();

    expect(proc.exits).toEqual([1]);
    // The deadline is called off, which is what separates this from the timeout path.
    expect(clock.cleared).toEqual([clock.scheduled[0]?.handle]);
    expect(logger.lines.at(-1)).toMatchObject({
      level: 'error',
      msg: 'shutdown failed, exiting',
      obj: { err: 'socket stuck' },
    });
  });

  it('answers a second signal immediately without waiting for the first close', async () => {
    const proc = fakeProcess();
    const clock = fakeClock();
    const logger = recordingLogger();
    let closes = 0;

    installShutdownHandlers(
      targetThat(() => {
        closes += 1;
        return new Promise(() => {});
      }),
      { logger, process: proc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    );

    proc.emit('SIGINT');
    proc.emit('SIGINT');
    await flush();

    expect(proc.exits).toEqual([SHUTDOWN_FORCED_EXIT_CODE]);
    expect(closes).toBe(1);
    expect(logger.lines.at(-1)).toMatchObject({
      level: 'warn',
      msg: 'shutdown already running, exiting now',
    });
  });

  it('ignores a deadline that fires after the close already won', async () => {
    const proc = fakeProcess();
    const clock = fakeClock();

    installShutdownHandlers(
      targetThat(async () => undefined),
      {
        logger: recordingLogger(),
        process: proc,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
      },
    );

    proc.emit('SIGINT');
    await flush();
    clock.fireLast();

    expect(proc.exits).toEqual([0]);
  });

  it('registers exactly the signals it was given', () => {
    const defaults = fakeProcess();
    installShutdownHandlers(
      targetThat(async () => undefined),
      { logger: recordingLogger(), process: defaults },
    );
    expect(defaults.signals()).toEqual([...SHUTDOWN_SIGNALS]);

    const custom = fakeProcess();
    installShutdownHandlers(
      targetThat(async () => undefined),
      { logger: recordingLogger(), process: custom, signals: ['SIGHUP'] },
    );
    expect(custom.signals()).toEqual(['SIGHUP']);
  });
});

describe('watchStdinForExit', () => {
  it.each(['end', 'close'])('shuts down when stdin emits %s', (event) => {
    const stream = new EventEmitter();
    const reasons: string[] = [];

    watchStdinForExit(stream, (reason) => reasons.push(reason), recordingLogger());
    stream.emit(event);

    expect(reasons).toEqual(['stdin closed']);
  });

  it('shuts down and logs when stdin errors', () => {
    const stream = new EventEmitter();
    const reasons: string[] = [];
    const logger = recordingLogger();

    watchStdinForExit(stream, (reason) => reasons.push(reason), logger);
    stream.emit('error', new Error('broken pipe'));

    expect(reasons).toEqual(['stdin error']);
    expect(logger.lines.at(-1)).toMatchObject({ level: 'warn', obj: { err: 'broken pipe' } });
  });

  it('shuts down once however many of the events arrive', () => {
    const stream = new EventEmitter();
    const reasons: string[] = [];

    watchStdinForExit(stream, (reason) => reasons.push(reason), recordingLogger());
    stream.emit('end');
    stream.emit('close');
    stream.emit('error', new Error('too late'));

    expect(reasons).toEqual(['stdin closed']);
  });

  it('resumes the stream, because a paused readable never reaches end-of-file', () => {
    let resumed = 0;
    const stream = Object.assign(new EventEmitter(), {
      resume: () => {
        resumed += 1;
      },
    });

    watchStdinForExit(stream, () => undefined, recordingLogger());

    expect(resumed).toBe(1);
  });
});

describe('shouldWatchStdin', () => {
  it('is on only for exactly "1"', () => {
    expect(shouldWatchStdin({ [EXIT_ON_STDIN_CLOSE_ENV]: '1' })).toBe(true);
    expect(shouldWatchStdin({})).toBe(false);
    expect(shouldWatchStdin({ [EXIT_ON_STDIN_CLOSE_ENV]: '' })).toBe(false);
    expect(shouldWatchStdin({ [EXIT_ON_STDIN_CLOSE_ENV]: '0' })).toBe(false);
    expect(shouldWatchStdin({ [EXIT_ON_STDIN_CLOSE_ENV]: 'true' })).toBe(false);
  });
});
