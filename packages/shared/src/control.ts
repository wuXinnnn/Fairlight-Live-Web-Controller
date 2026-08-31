import { z } from 'zod';
import { LEVEL_DB_MAX, LEVEL_DB_MIN } from './channel.js';
import { errorBodySchema } from './errors.js';

export const setLevelCommandSchema = z.object({
  id: z.string().min(1),
  levelDb: z.number().min(LEVEL_DB_MIN).max(LEVEL_DB_MAX),
});
export type SetLevelCommand = z.infer<typeof setLevelCommandSchema>;

export const setOnCommandSchema = z.object({
  id: z.string().min(1),
  on: z.boolean(),
});
export type SetOnCommand = z.infer<typeof setOnCommandSchema>;

export const resetLoudnessCommandSchema = z.union([
  z.undefined(),
  z.null(),
  z.record(z.string(), z.unknown()),
]);
export type ResetLoudnessCommand = z.infer<typeof resetLoudnessCommandSchema>;

export const controlAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    error: errorBodySchema,
  }),
]);
export type ControlAck = z.infer<typeof controlAckSchema>;
