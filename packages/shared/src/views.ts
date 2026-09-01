import { z } from 'zod';
import { viewSchema } from './config.js';

export const viewWriteBodySchema = viewSchema.omit({ id: true });
export const viewsListResponseSchema = z.array(viewSchema);

export type ViewWriteBody = z.infer<typeof viewWriteBodySchema>;
export type ViewsListResponse = z.infer<typeof viewsListResponseSchema>;
