import { z } from 'zod';
import { CHANNEL_KINDS, channelKindSchema, type ChannelKind } from './channel.js';

export const DEFAULT_EMBER_HOST = '127.0.0.1';
export const DEFAULT_EMBER_PORT = 9000;

export const CHANNEL_PALETTE_KEYS = ['green', 'red', 'teal', 'navy', 'lime', 'purple'] as const;
export const channelPaletteKeySchema = z.enum(CHANNEL_PALETTE_KEYS);
export type ChannelPaletteKey = z.infer<typeof channelPaletteKeySchema>;

/**
 * Colour of a channel in a view: one of the palette keys, or `'group'` to follow the colour of
 * the group the channel belongs to. `'group'` therefore only makes sense inside a group.
 */
export const viewChannelColorSchema = z.union([channelPaletteKeySchema, z.literal('group')]);
export type ViewChannelColor = z.infer<typeof viewChannelColorSchema>;

/**
 * A view references a mixer channel by its kind and user-facing name. Fairlight Live does not
 * expose a stable channel id: inserting or reordering strips renumbers the Ember identifiers,
 * so the logical `channelId` (for example `channel/3`) only survives as a tie-breaker when two
 * live channels share the same kind and name.
 */
export const viewChannelRefSchema = z.object({
  kind: channelKindSchema,
  name: z.string().trim().min(1),
  channelId: z.string().min(1).optional(),
  color: viewChannelColorSchema.optional(),
});
export type ViewChannelRef = z.infer<typeof viewChannelRefSchema>;

/** A named group of channels. It owns its members, so an empty group is simply one with none. */
export const viewGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  /** Overrides the colour the group would take from its members' types. */
  color: channelPaletteKeySchema.optional(),
  channels: z.array(viewChannelRefSchema),
});
export type ViewGroup = z.infer<typeof viewGroupSchema>;

/**
 * One entry of a view, in display order: either a channel on its own or a whole group. Groups
 * carry their members, so a group has a place in the list even when it is empty, and membership
 * is a matter of where a reference sits rather than an id it has to agree with.
 */
export const viewItemSchema = z.discriminatedUnion('type', [
  viewChannelRefSchema.extend({ type: z.literal('channel') }),
  viewGroupSchema.extend({ type: z.literal('group') }),
]);
export type ViewItem = z.infer<typeof viewItemSchema>;
export type ViewChannelItem = Extract<ViewItem, { type: 'channel' }>;
export type ViewGroupItem = Extract<ViewItem, { type: 'group' }>;

/** Object shape shared by the persisted view and the REST write body; refinements are added per schema. */
export const viewObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  items: z.array(viewItemSchema).default([]),
});

interface ViewItemIntegrity {
  items: ViewItem[];
}

/**
 * Ensures group ids are unique and that no channel outside a group asks to follow a group
 * colour. Membership itself needs no check: it is structural.
 */
export function checkViewItems(view: ViewItemIntegrity, ctx: z.RefinementCtx): void {
  const groupIds = new Set<string>();
  view.items.forEach((item, index) => {
    if (item.type === 'group') {
      if (groupIds.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `Duplicate group id "${item.id}"`,
        });
      }
      groupIds.add(item.id);
      return;
    }
    if (item.color === 'group') {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'color'],
        message: 'Channel color "group" requires a group',
      });
    }
  });
}

export const viewSchema = viewObjectSchema.superRefine(checkViewItems);
export type View = z.infer<typeof viewSchema>;

/** Every channel reference of a view in display order, root-level entries and members alike. */
export function viewChannelRefs(view: Pick<View, 'items'>): ViewChannelRef[] {
  return view.items.flatMap((item) => (item.type === 'channel' ? [item] : item.channels));
}

/** The groups of a view, in the order their blocks appear. */
export function viewGroups(view: Pick<View, 'items'>): ViewGroup[] {
  return view.items.filter((item): item is ViewGroupItem => item.type === 'group');
}

export const emberEndpointSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});
export type EmberEndpoint = z.infer<typeof emberEndpointSchema>;

export const appConfigObjectSchema = z.object({
  version: z.literal(2),
  ember: emberEndpointSchema,
  views: z.array(viewSchema),
});

function kindFromChannelId(channelId: string): ChannelKind {
  const prefix = channelId.split('/')[0];
  return CHANNEL_KINDS.find((kind) => kind === prefix) ?? 'channel';
}

/** Migrates the pre-grouping `{ channelId, lastKnownName }` reference shape. */
function migrateLegacyChannelRef(input: unknown): Record<string, unknown> {
  const candidate = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  if (
    typeof candidate.channelId !== 'string' ||
    typeof candidate.lastKnownName !== 'string' ||
    'name' in candidate
  ) {
    return candidate;
  }
  // Old references could carry an empty name; fall back to the id so one such entry never
  // invalidates the whole persisted config.
  const migrated: Record<string, unknown> = {
    kind: kindFromChannelId(candidate.channelId),
    name: candidate.lastKnownName.trim().length > 0 ? candidate.lastKnownName : candidate.channelId,
    channelId: candidate.channelId,
  };
  if (candidate.color !== undefined) {
    migrated.color = candidate.color;
  }
  return migrated;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Rebuilds one version 1 view as ordered items. Version 1 stored a flat `channels` array whose
 * entries pointed at `groups` by id, so a group's place in the list could only be inferred from
 * where its members happened to sit — and a group with no members had no place at all. Here each
 * run of consecutive members becomes one group block in that same spot, groups nobody references
 * are appended (they had been shown at the end), and a `groupId` pointing at nothing is dropped,
 * which is how the old reader treated it too.
 */
function migrateLegacyView(input: unknown): unknown {
  const view = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(view.channels)) {
    return view;
  }
  const groups = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(view.groups)) {
    const group = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    if (typeof group.id === 'string') {
      groups.set(group.id, group);
    }
  }

  const items: Record<string, unknown>[] = [];
  const placed = new Set<string>();
  for (const entry of view.channels) {
    const { groupId, ...reference } = migrateLegacyChannelRef(entry);
    if (typeof groupId !== 'string' || !groups.has(groupId)) {
      items.push({ ...reference, type: 'channel' });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.type === 'group' && last.id === groupId) {
      (last.channels as Record<string, unknown>[]).push(reference);
      continue;
    }
    placed.add(groupId);
    items.push({ ...groups.get(groupId), type: 'group', channels: [reference] });
  }
  for (const [id, group] of groups) {
    if (!placed.has(id)) {
      items.push({ ...group, type: 'group', channels: [] });
    }
  }
  const rest = { ...view };
  delete rest.channels;
  delete rest.groups;
  return { ...rest, items };
}

/**
 * Brings a persisted config up to version 2. Anything already at version 2 is returned as it is,
 * and any other version is passed through for the schema to reject. Migrating on read means the
 * next save writes version 2 without the server knowing anything about it.
 */
export function migrateAppConfig(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return input;
  }
  const config = input as Record<string, unknown>;
  if (config.version !== 1) {
    return config;
  }
  return { ...config, version: 2, views: asArray(config.views).map(migrateLegacyView) };
}

export const appConfigSchema = z.preprocess(migrateAppConfig, appConfigObjectSchema);
export type AppConfig = z.infer<typeof appConfigObjectSchema>;

export function defaultAppConfig(): AppConfig {
  return {
    version: 2,
    ember: { host: DEFAULT_EMBER_HOST, port: DEFAULT_EMBER_PORT },
    views: [],
  };
}
