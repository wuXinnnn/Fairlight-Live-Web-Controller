import { existsSync } from 'node:fs';
import { Server } from 'socket.io';
import pino from 'pino';
import { createApp } from './app.js';
import type { AppLogger } from './logger.js';
import { silentLogger } from './logger.js';
import { resolveConfigPath, resolveWebDist } from './paths.js';
import { MixerRuntime } from './runtime.js';
import { attachGateway } from './ws/gateway.js';

export interface StartOptions {
  host?: string;
  port?: number;
  staticRoot?: string;
  configDir?: string;
  silent?: boolean;
  runtime?: MixerRuntime;
  timeoutMs?: number;
  disconnectTimeoutMs?: number;
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
  treeRefreshDebounceMs?: number;
  incompleteStripRetryMs?: number;
  busDirectoryPollMs?: number;
}

export interface StartedServer {
  app: Awaited<ReturnType<typeof createApp>>;
  runtime: MixerRuntime;
  io: Server;
}

export function resolveBindAddress(
  options: Pick<StartOptions, 'host' | 'port'> = {},
  env: { HOST?: string; PORT?: string } = process.env,
): { host: string; port: number } {
  return {
    host: options.host ?? env.HOST ?? '127.0.0.1',
    port: options.port ?? Number(env.PORT ?? '3000'),
  };
}

export async function start(options: StartOptions = {}): Promise<StartedServer> {
  const { host, port } = resolveBindAddress(options);
  const staticRoot = options.staticRoot ?? resolveWebDist();
  const logger: AppLogger = options.silent === true ? silentLogger() : pino({ name: 'flwc' });
  const runtime =
    options.runtime ??
    new MixerRuntime({
      configPath: resolveConfigPath(options.configDir),
      logger,
      timeoutMs: options.timeoutMs,
      disconnectTimeoutMs: options.disconnectTimeoutMs,
      reconnectInitialMs: options.reconnectInitialMs,
      reconnectMaxMs: options.reconnectMaxMs,
      treeRefreshDebounceMs: options.treeRefreshDebounceMs,
      incompleteStripRetryMs: options.incompleteStripRetryMs,
      busDirectoryPollMs: options.busDirectoryPollMs,
    });
  const app = await createApp({
    staticRoot: existsSync(staticRoot) ? staticRoot : undefined,
    runtime,
    logger: options.silent === true ? false : { name: 'flwc' },
  });
  const io = new Server(app.server, { cors: { origin: true } });
  attachGateway(io, runtime, logger);
  app.addHook('onClose', async () => {
    io.close();
    await runtime.stop();
  });
  await app.listen({ host, port });
  await runtime.start();
  return { app, runtime, io };
}
