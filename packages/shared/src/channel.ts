import { z } from 'zod';

export const CHANNEL_KINDS = ['channel', 'main', 'sub', 'aux', 'mixm', 'mtx'] as const;

export const channelKindSchema = z.enum(CHANNEL_KINDS);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const LEVEL_DB_MIN = -100;
export const LEVEL_DB_MAX = 10;
export const DEFAULT_METER_DB = -60;
export const DEFAULT_INTEGRATED_LUFS = -60;
export const DEFAULT_TRUE_PEAK_DBTP = -60;

export const connectionStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const channelRefSchema = z.object({
  id: z.string().min(1),
  kind: channelKindSchema,
  name: z.string(),
});
export type ChannelRef = z.infer<typeof channelRefSchema>;

export const channelStateSchema = channelRefSchema.extend({
  levelDb: z.number(),
  muted: z.boolean(),
  meterDb: z.number(),
});
export type ChannelState = z.infer<typeof channelStateSchema>;

export const loudnessStateSchema = z.object({
  integratedLufs: z.number(),
  truePeakDbtp: z.number(),
});
export type LoudnessState = z.infer<typeof loudnessStateSchema>;

export function defaultLoudnessState(): LoudnessState {
  return {
    integratedLufs: DEFAULT_INTEGRATED_LUFS,
    truePeakDbtp: DEFAULT_TRUE_PEAK_DBTP,
  };
}
