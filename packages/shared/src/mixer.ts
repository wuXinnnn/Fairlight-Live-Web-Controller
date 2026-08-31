import { z } from 'zod';
import { channelStateSchema, connectionStatusSchema, loudnessStateSchema } from './channel.js';

export const mixerSnapshotSchema = z.object({
  channels: z.array(channelStateSchema),
  loudness: loudnessStateSchema,
  connection: connectionStatusSchema,
});
export type MixerSnapshot = z.infer<typeof mixerSnapshotSchema>;

export const mixerPatchSchema = z.object({
  upserts: z.array(channelStateSchema).optional(),
  removedIds: z.array(z.string().min(1)).optional(),
  loudness: loudnessStateSchema.optional(),
});
export type MixerPatch = z.infer<typeof mixerPatchSchema>;

export const meterEntrySchema = z.tuple([z.string().min(1), z.number()]);
export type MeterEntry = z.infer<typeof meterEntrySchema>;

export const metersFrameSchema = z.object({
  meters: z.array(meterEntrySchema),
  loudness: loudnessStateSchema.optional(),
});
export type MetersFrame = z.infer<typeof metersFrameSchema>;

export const systemStatusSchema = z.object({
  ember: connectionStatusSchema,
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;
