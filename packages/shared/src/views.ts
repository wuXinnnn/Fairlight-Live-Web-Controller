import { z } from 'zod';
import { checkViewGroups, viewObjectSchema, viewSchema } from './config.js';

export const viewWriteBodySchema = viewObjectSchema.omit({ id: true }).superRefine(checkViewGroups);
export const viewsListResponseSchema = z.array(viewSchema);

export type ViewWriteBody = z.infer<typeof viewWriteBodySchema>;
export type ViewsListResponse = z.infer<typeof viewsListResponseSchema>;
