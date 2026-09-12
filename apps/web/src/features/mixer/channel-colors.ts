import type { ChannelKind, ChannelPaletteKey, ViewChannelColor, ViewGroup } from '@flwc/shared';

export const CHANNEL_PALETTE: Record<ChannelPaletteKey, string> = {
  green: '#55b978',
  red: '#d95f63',
  teal: '#3fa9a3',
  navy: '#4f6fae',
  lime: '#a7cf4d',
  purple: '#9b6ac8',
};

export const CHANNEL_TYPE_COLORS: Record<ChannelKind, ChannelPaletteKey> = {
  channel: 'green',
  main: 'red',
  sub: 'teal',
  aux: 'navy',
  mixm: 'lime',
  mtx: 'purple',
};

export function channelTypeColor(kind: ChannelKind): string {
  return CHANNEL_PALETTE[CHANNEL_TYPE_COLORS[kind]];
}

export function channelColor(kind: ChannelKind, color?: ChannelPaletteKey): string {
  return CHANNEL_PALETTE[color ?? CHANNEL_TYPE_COLORS[kind]];
}

/**
 * The kind most of `kinds` are. A tie goes to whichever of the tied kinds comes first, so the
 * answer only depends on the list and not on how it was counted. An empty list has no answer.
 */
export function dominantChannelKind(kinds: readonly ChannelKind[]): ChannelKind | undefined {
  const counts = new Map<ChannelKind, number>();
  for (const kind of kinds) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: ChannelKind | undefined;
  let bestCount = 0;
  for (const kind of kinds) {
    const count = counts.get(kind) ?? 0;
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Colour of a group: its own override, or the type colour most of its members are. Members are
 * counted by the kind their reference records, so a member the mixer cannot currently resolve
 * still counts and the colour does not shift about while the tree loads. A member's own override
 * is deliberately ignored, so one set to follow the group cannot ask the group to follow it
 * back. A group with no members falls back to the input colour, which is what the configuration
 * page shows for a group waiting to be filled.
 */
export function groupAccent(group: ViewGroup | undefined): string {
  if (group?.color !== undefined) {
    return CHANNEL_PALETTE[group.color];
  }
  const kinds = group?.channels.map((channel) => channel.kind) ?? [];
  return channelTypeColor(dominantChannelKind(kinds) ?? 'channel');
}

/**
 * Colour of one channel of a view: `'group'` follows the group it belongs to, a palette key wins
 * outright, and no colour at all falls back to the channel's type. A `'group'` colour without a
 * group cannot be saved (the shared schema rejects it) but is treated as automatic here so a
 * draft mid-edit never renders as nothing.
 */
export function channelAccent(
  kind: ChannelKind,
  color: ViewChannelColor | undefined,
  group: ViewGroup | undefined,
): string {
  if (color === 'group') {
    return group === undefined ? channelTypeColor(kind) : groupAccent(group);
  }
  return channelColor(kind, color);
}
