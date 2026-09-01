import {
  ERROR_CODES,
  viewsListResponseSchema,
  viewSchema,
  viewWriteBodySchema,
} from '@flwc/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ViewNotFoundError, type MixerRuntime } from '../runtime.js';

interface ViewParams {
  id: string;
}

function sendInvalidBody(request: FastifyRequest, reply: FastifyReply, message: string) {
  request.log.warn({ err: message, layer: 'validation' }, 'invalid view body');
  return reply.code(400).send({
    error: { code: ERROR_CODES.VALIDATION, message },
  });
}

function sendNotFound(reply: FastifyReply, error: ViewNotFoundError) {
  return reply.code(404).send({
    error: { code: ERROR_CODES.NOT_FOUND, message: error.message },
  });
}

export function registerViewRoutes(app: FastifyInstance, runtime: MixerRuntime): void {
  app.get('/api/v1/views', async () => viewsListResponseSchema.parse(runtime.listViews()));

  app.post('/api/v1/views', async (request, reply) => {
    const parsed = viewWriteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalidBody(request, reply, parsed.error.message);
    }
    const view = await runtime.createView(parsed.data);
    return reply.code(201).send(viewSchema.parse(view));
  });

  app.put<{ Params: ViewParams }>('/api/v1/views/:id', async (request, reply) => {
    const parsed = viewWriteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalidBody(request, reply, parsed.error.message);
    }
    try {
      return viewSchema.parse(await runtime.updateView(request.params.id, parsed.data));
    } catch (error) {
      if (error instanceof ViewNotFoundError) {
        return sendNotFound(reply, error);
      }
      throw error;
    }
  });

  app.delete<{ Params: ViewParams }>('/api/v1/views/:id', async (request, reply) => {
    try {
      await runtime.deleteView(request.params.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof ViewNotFoundError) {
        return sendNotFound(reply, error);
      }
      throw error;
    }
  });
}
