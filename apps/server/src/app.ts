import fastifyStatic from '@fastify/static';
import { ERROR_CODES, healthResponseSchema } from '@flwc/shared';
import Fastify from 'fastify';
import type { FastifyError, FastifyServerOptions } from 'fastify';
import { registerConnectionRoutes } from './api/connection.js';
import { registerViewRoutes } from './api/views.js';
import type { MixerRuntime } from './runtime.js';

export interface CreateAppOptions {
  staticRoot?: string;
  runtime?: MixerRuntime;
  logger?: FastifyServerOptions['logger'];
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const isValidation = error.validation !== undefined;
    request.log.error(
      { err: error, layer: isValidation ? 'validation' : 'internal' },
      'request failed',
    );
    const statusCode = isValidation ? 400 : (error.statusCode ?? 500);
    const code = isValidation ? ERROR_CODES.VALIDATION : ERROR_CODES.INTERNAL;
    void reply.code(statusCode).send({
      error: { code, message: error.message },
    });
  });

  app.get('/api/v1/health', async () => healthResponseSchema.parse({ status: 'ok' }));

  if (options.runtime !== undefined) {
    registerConnectionRoutes(app, options.runtime);
    registerViewRoutes(app, options.runtime);
  }

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
    });
    // The web app owns client-side routes such as /views; serve the SPA shell for any
    // unmatched GET that is not an API call so a page reload or deep link keeps working.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: `Route ${request.url} not found` },
        });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
