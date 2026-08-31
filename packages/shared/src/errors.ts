import { z } from 'zod';

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  PROTOCOL: 'PROTOCOL',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const errorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const apiErrorSchema = z.object({
  error: errorBodySchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;
