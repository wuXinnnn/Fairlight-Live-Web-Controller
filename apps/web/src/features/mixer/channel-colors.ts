import type { ChannelKind, ChannelPaletteKey } from '@flwc/shared';

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
