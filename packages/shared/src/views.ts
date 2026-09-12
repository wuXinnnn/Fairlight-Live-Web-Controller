import { z } from 'zod';
import { checkViewItems, viewObjectSchema, viewSchema } from './config.js';

export const viewWriteBodySchema = viewObjectSchema.omit({ id: true }).superRefine(checkViewItems);
export const viewsListResponseSchema = z.array(viewSchema);

export type ViewWriteBody = z.infer<typeof viewWriteBodySchema>;
export type ViewsListResponse = z.infer<typeof viewsListResponseSchema>;
