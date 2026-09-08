import type { ChannelKind, ChannelPaletteKey } from '@flwc/shared';

export const KIND_LABELS: Record<ChannelKind, string> = {
  channel: 'INPUT',
  main: 'MAIN',
  sub: 'SUB',
  aux: 'AUX',
  mixm: 'MIX MINUS',
  mtx: 'MATRIX',
};

export const PALETTE_LABELS: Record<ChannelPaletteKey, string> = {
  green: 'Input Green',
  red: 'Main Red',
  teal: 'Sub Teal',
  navy: 'Aux Navy',
  lime: 'Mix Minus Lime',
  purple: 'Matrix Purple',
};

export function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
