import type { FastifyInstance } from 'fastify';
import { connectionGetResponseSchema, connectionPutBodySchema, ERROR_CODES } from '@flwc/shared';
import type { MixerRuntime } from '../runtime.js';

export function registerConnectionRoutes(app: FastifyInstance, runtime: MixerRuntime): void {
  app.get('/api/v1/connection', async () => {
    const { host, port } = runtime.config.snapshot.ember;
    return connectionGetResponseSchema.parse({
      host,
      port,
      status: runtime.store.connection,
    });
  });

  app.put('/api/v1/connection', async (request, reply) => {
    const parsed = connectionPutBodySchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        { err: parsed.error.message, layer: 'validation' },
        'invalid connection body',
      );
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION, message: parsed.error.message },
      });
    }
    await runtime.updateEndpoint(parsed.data);
    return connectionGetResponseSchema.parse({
      host: parsed.data.host,
      port: parsed.data.port,
      status: runtime.store.connection,
    });
  });
}
