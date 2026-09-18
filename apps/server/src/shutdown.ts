import type { AppLogger } from './logger.js';
import { errorMessage } from './logger.js';

/** How long a shutdown is given to finish before the process is cut short. */
export const SHUTDOWN_TIMEOUT_MS = 5000;
/** The exit code for a shutdown that a second signal cut short: 128 + SIGINT, by convention. */
export const SHUTDOWN_FORCED_EXIT_CODE = 130;
/** The signals a console, a container runtime and a desktop shell all use to ask for a stop. */
export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
/** Set to `1` by a process supervisor that ties this process to the stdin pipe it holds. */
export const EXIT_ON_STDIN_CLOSE_ENV = 'FLWC_EXIT_ON_STDIN_CLOSE';

/**
 * What a shutdown closes. The Fastify instance `start()` returns satisfies it: its `onClose`
 * hook already shuts the socket.io server and the Ember connection down.
 */
export interface ShutdownTarget {
  close(): Promise<unknown>;
}

/**
 * The slice of `process` this module touches, so a test can hand it a fake.
 *
 * `on` rather than `once`: a second signal has to reach the handler to be answered with
 * {@link SHUTDOWN_FORCED_EXIT_CODE}, and a handler registered with `once` is gone by then.
 */
export interface ShutdownProcess {
  on(event: string, listener: () => void): unknown;
  exit(code: number): void;
}

/** A timer handle: Node hands back a `Timeout`, a fake is free to hand back a plain number. */
export type TimerHandle = NodeJS.Timeout | number;

export interface ShutdownOptions {
  logger: AppLogger;
  signals?: readonly string[];
  process?: ShutdownProcess;
  setTimeout?: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
  timeoutMs?: number;
}

/**
 * Starts a shutdown for the given reason. Calling it again while one is running is what a
 * second Ctrl+C means, and it exits immediately.
 */
export type ShutdownFn = (reason: string) => void;

/**
 * Makes the process answer a stop request instead of ignoring it.
 *
 * Without this, a Node process running as PID 1 in a container ignores every signal it has no
 * handler for, so `docker stop` waits out its whole grace period before resorting to SIGKILL.
 *
 * Returns the shutdown function so a caller can drive the same path from somewhere other than a
 * signal — see {@link watchStdinForExit}.
 */
export function installShutdownHandlers(
  target: ShutdownTarget,
  options: ShutdownOptions,
): ShutdownFn {
  const {
    logger,
    signals = SHUTDOWN_SIGNALS,
    process: proc = process,
    setTimeout: schedule = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
    timeoutMs = SHUTDOWN_TIMEOUT_MS,
  } = options;

  let started = false;

  const shutdown: ShutdownFn = (reason) => {
    if (started) {
      // A second signal is an operator who has stopped waiting. Nothing is left half written:
      // config writes are atomic, so the most an unfinished one can lose is itself.
      logger.warn({ reason, layer: 'lifecycle' }, 'shutdown already running, exiting now');
      proc.exit(SHUTDOWN_FORCED_EXIT_CODE);
      return;
    }
    started = true;
    logger.info({ reason, timeoutMs, layer: 'lifecycle' }, 'shutting down');

    // One flag settles the race between `close()` returning and the deadline firing, so exactly
    // one of them reaches `exit`. A real `exit` never returns, but a fake one does, which is what
    // makes the losing branch observable at all.
    let settled = false;

    const timer = schedule(() => {
      if (settled) {
        return;
      }
      settled = true;
      logger.error({ reason, timeoutMs, layer: 'lifecycle' }, 'shutdown timed out, exiting');
      proc.exit(1);
    }, timeoutMs);

    const finish = (code: number, error?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancel(timer);
      if (error === undefined) {
        logger.info({ reason, layer: 'lifecycle' }, 'shutdown complete');
      } else {
        logger.error(
          { reason, err: errorMessage(error), layer: 'lifecycle' },
          'shutdown failed, exiting',
        );
      }
      proc.exit(code);
    };

    void (async () => {
      try {
        await target.close();
        finish(0);
      } catch (error) {
        finish(1, error);
      }
    })();
  };

  for (const signal of signals) {
    proc.on(signal, () => shutdown(signal));
  }
  return shutdown;
}

export interface DeferredShutdownTarget extends ShutdownTarget {
  /** Hand over the real target once there is one. */
  attach(target: ShutdownTarget): void;
}

/**
 * A stand-in for a target that does not exist yet.
 *
 * The handlers have to be installed *before* the server is awaited, not after. `start()` opens
 * the listening socket and then waits on the Ember connection, and that wait does not end while
 * the desk is unreachable -- it keeps retrying the tree expand. Installing the handlers on the
 * result of `start()` would therefore leave the whole startup, and on an unreachable desk the
 * entire run, with no handler at all: as PID 1 the kernel discards the SIGTERM, `docker stop`
 * burns its full grace period and ends in SIGKILL. Measured before this existed: a container
 * pointed at an address that does not answer ignored a stop issued 300ms after launch and was
 * killed 30 seconds later.
 *
 * A signal arriving before `attach` finds nothing to close, which is right: no configuration has
 * been written yet, and exiting releases the listening socket just as closing it would.
 */
export function deferredShutdownTarget(): DeferredShutdownTarget {
  let target: ShutdownTarget | undefined;
  return {
    attach(next) {
      target = next;
    },
    async close() {
      await target?.close();
    },
  };
}

/**
 * The slice of `process.stdin` this module touches. `resume` is optional so that a plain
 * `EventEmitter` can stand in for it in a test.
 */
export interface StdinLike {
  on(event: string, listener: (payload?: unknown) => void): unknown;
  resume?: () => void;
}

/**
 * Ties this process to the stdin pipe its parent holds.
 *
 * A desktop launcher spawns the server with stdin as a pipe. However the launcher goes away --
 * it exits, it crashes, Task Manager ends it, the user logs out -- the pipe breaks, and this is
 * what makes the server notice and leave with it. Windows and macOS need no job objects and no
 * process groups for that, only these events.
 *
 * All three are watched because the shape of the break is not worth predicting: a writer that
 * closes cleanly gives `end` and then `close`, while a pipe torn down under the process can
 * surface as an `error` instead. The first one to arrive wins and the rest are ignored.
 *
 * `resume()` at the end is not optional. `process.stdin` starts paused, and a paused readable
 * never reaches end-of-file, so without it none of the three events would ever arrive.
 */
export function watchStdinForExit(
  stream: StdinLike,
  shutdown: ShutdownFn,
  logger: AppLogger,
): void {
  let fired = false;

  const trigger = (reason: string, error?: unknown): void => {
    if (fired) {
      return;
    }
    fired = true;
    if (error !== undefined) {
      logger.warn({ err: errorMessage(error), layer: 'lifecycle' }, 'stdin failed');
    }
    shutdown(reason);
  };

  stream.on('end', () => trigger('stdin closed'));
  stream.on('close', () => trigger('stdin closed'));
  stream.on('error', (error) => trigger('stdin error', error));
  stream.resume?.();
}

/**
 * Whether this process was asked to treat its stdin as a leash. Left unset, stdin is not touched
 * at all: someone who started the server from a console still wants Ctrl+C, and resuming stdin
 * would also hold the event loop open.
 */
export function shouldWatchStdin(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXIT_ON_STDIN_CLOSE_ENV] === '1';
}
