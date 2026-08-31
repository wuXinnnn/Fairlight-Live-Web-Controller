import fastifyStatic from '@fastify/static';
import { healthResponseSchema } from '@flwc/shared';
import Fastify from 'fastify';

export interface CreateAppOptions {
  staticRoot?: string;
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: false });

  app.get('/api/v1/health', async () => healthResponseSchema.parse({ status: 'ok' }));

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
    });
  }

  return app;
}
