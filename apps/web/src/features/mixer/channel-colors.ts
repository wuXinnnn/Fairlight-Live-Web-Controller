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
 * Colour of a group: its own override, or the type colour of its first present member. The
 * member's own override is deliberately ignored, so a member set to follow the group cannot end
 * up asking the group to follow it back. A group with no present member falls back to the input
 * colour, which is what the configuration page shows for a group waiting to be filled.
 */
export function groupAccent(group: ViewGroup | undefined, leadKind: ChannelKind | undefined) {
  if (group?.color !== undefined) {
    return CHANNEL_PALETTE[group.color];
  }
  return channelTypeColor(leadKind ?? 'channel');
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
  leadKind?: ChannelKind,
): string {
  if (color === 'group') {
    return group === undefined ? channelTypeColor(kind) : groupAccent(group, leadKind);
  }
  return channelColor(kind, color);
}
