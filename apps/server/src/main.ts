import pino from 'pino';
import { start } from './server.js';
import {
  deferredShutdownTarget,
  installShutdownHandlers,
  shouldWatchStdin,
  watchStdinForExit,
} from './shutdown.js';

// The handlers go on before the server is awaited, not after: start() waits on the Ember
// connection, and that wait does not end while the desk is unreachable.
const logger = pino({ name: 'flwc' });
const target = deferredShutdownTarget();
const shutdown = installShutdownHandlers(target, { logger });

if (shouldWatchStdin(process.env)) {
  watchStdinForExit(process.stdin, shutdown, logger);
}

target.attach((await start({ logger })).app);
