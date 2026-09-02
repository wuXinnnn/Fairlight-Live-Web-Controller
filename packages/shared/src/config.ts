import { z } from 'zod';

export const DEFAULT_EMBER_HOST = '127.0.0.1';
export const DEFAULT_EMBER_PORT = 9000;

export const CHANNEL_PALETTE_KEYS = ['green', 'red', 'teal', 'navy', 'lime', 'purple'] as const;
export const channelPaletteKeySchema = z.enum(CHANNEL_PALETTE_KEYS);
export type ChannelPaletteKey = z.infer<typeof channelPaletteKeySchema>;

export const viewChannelRefSchema = z.object({
  channelId: z.string().min(1),
  lastKnownName: z.string(),
  color: channelPaletteKeySchema.optional(),
});
export type ViewChannelRef = z.infer<typeof viewChannelRefSchema>;

export const viewSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  channels: z.array(viewChannelRefSchema),
});
export type View = z.infer<typeof viewSchema>;

export const emberEndpointSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});
export type EmberEndpoint = z.infer<typeof emberEndpointSchema>;

export const appConfigSchema = z.object({
  version: z.literal(1),
  ember: emberEndpointSchema,
  views: z.array(viewSchema),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export function defaultAppConfig(): AppConfig {
  return {
    version: 1,
    ember: { host: DEFAULT_EMBER_HOST, port: DEFAULT_EMBER_PORT },
    views: [],
  };
}
