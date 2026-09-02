import { z } from 'zod';
import { CHANNEL_KINDS, channelKindSchema, type ChannelKind } from './channel.js';

export const DEFAULT_EMBER_HOST = '127.0.0.1';
export const DEFAULT_EMBER_PORT = 9000;

export const CHANNEL_PALETTE_KEYS = ['green', 'red', 'teal', 'navy', 'lime', 'purple'] as const;
export const channelPaletteKeySchema = z.enum(CHANNEL_PALETTE_KEYS);
export type ChannelPaletteKey = z.infer<typeof channelPaletteKeySchema>;

/**
 * A view references a mixer channel by its kind and user-facing name. Fairlight Live does not
 * expose a stable channel id: inserting or reordering strips renumbers the Ember identifiers,
 * so the logical `channelId` (for example `channel/3`) only survives as a tie-breaker when two
 * live channels share the same kind and name.
 */
const viewChannelRefObjectSchema = z.object({
  kind: channelKindSchema,
  name: z.string().trim().min(1),
  channelId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  color: channelPaletteKeySchema.optional(),
});

function kindFromChannelId(channelId: string): ChannelKind {
  const prefix = channelId.split('/')[0];
  return CHANNEL_KINDS.find((kind) => kind === prefix) ?? 'channel';
}

/** Migrates the pre-grouping `{ channelId, lastKnownName }` reference shape in place. */
function migrateLegacyChannelRef(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return input;
  }
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.channelId !== 'string' ||
    typeof candidate.lastKnownName !== 'string' ||
    'name' in candidate
  ) {
    return input;
  }
  const migrated: Record<string, unknown> = {
    kind: kindFromChannelId(candidate.channelId),
    name: candidate.lastKnownName,
    channelId: candidate.channelId,
  };
  if (candidate.color !== undefined) {
    migrated.color = candidate.color;
  }
  return migrated;
}

export const viewChannelRefSchema = z.preprocess(
  migrateLegacyChannelRef,
  viewChannelRefObjectSchema,
);
export type ViewChannelRef = z.infer<typeof viewChannelRefObjectSchema>;

export const viewGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});
export type ViewGroup = z.infer<typeof viewGroupSchema>;

/** Object shape shared by the persisted view and the REST write body; refinements are added per schema. */
export const viewObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  channels: z.array(viewChannelRefSchema),
  groups: z.array(viewGroupSchema).default([]),
});

interface ViewGroupIntegrity {
  channels: ViewChannelRef[];
  groups: ViewGroup[];
}

/** Ensures group ids are unique and every channel `groupId` points at an existing group. */
export function checkViewGroups(view: ViewGroupIntegrity, ctx: z.RefinementCtx): void {
  const groupIds = new Set<string>();
  view.groups.forEach((group, index) => {
    if (groupIds.has(group.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', index, 'id'],
        message: `Duplicate group id "${group.id}"`,
      });
    }
    groupIds.add(group.id);
  });
  view.channels.forEach((channel, index) => {
    if (channel.groupId !== undefined && !groupIds.has(channel.groupId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels', index, 'groupId'],
        message: `Unknown group id "${channel.groupId}"`,
      });
    }
  });
}

export const viewSchema = viewObjectSchema.superRefine(checkViewGroups);
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
