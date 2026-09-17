import { start } from './server.js';
import { installShutdownHandlers, shouldWatchStdin, watchStdinForExit } from './shutdown.js';

const { app, logger } = await start();
const shutdown = installShutdownHandlers(app, { logger });

if (shouldWatchStdin(process.env)) {
  watchStdinForExit(process.stdin, shutdown, logger);
}
