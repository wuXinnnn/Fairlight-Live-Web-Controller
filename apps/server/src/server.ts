import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { resolveWebDist } from './paths.js';

export interface StartOptions {
  host?: string;
  port?: number;
  staticRoot?: string;
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

export async function start(options: StartOptions = {}) {
  const { host, port } = resolveBindAddress(options);
  const staticRoot = options.staticRoot ?? resolveWebDist();
  const app = await createApp({
    staticRoot: existsSync(staticRoot) ? staticRoot : undefined,
  });
  await app.listen({ host, port });
  return app;
}
