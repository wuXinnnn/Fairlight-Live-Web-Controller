import { z } from 'zod';
import { connectionStatusSchema } from './channel.js';
import { emberEndpointSchema } from './config.js';

export const connectionGetResponseSchema = emberEndpointSchema.extend({
  status: connectionStatusSchema,
});
export type ConnectionGetResponse = z.infer<typeof connectionGetResponseSchema>;

export const connectionPutBodySchema = emberEndpointSchema;
export type ConnectionPutBody = z.infer<typeof connectionPutBodySchema>;
