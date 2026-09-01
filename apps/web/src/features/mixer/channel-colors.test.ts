import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PALETTE,
  CHANNEL_TYPE_COLORS,
  channelColor,
  channelTypeColor,
} from './channel-colors.js';

describe('channel colors', () => {
  it('maps every channel kind to the Fairlight default palette', () => {
    expect(CHANNEL_TYPE_COLORS).toEqual({
      channel: 'green',
      main: 'red',
      sub: 'teal',
      aux: 'navy',
      mixm: 'lime',
      mtx: 'purple',
    });
    expect(channelTypeColor('channel')).toBe(CHANNEL_PALETTE.green);
    expect(channelTypeColor('main')).toBe(CHANNEL_PALETTE.red);
    expect(channelTypeColor('sub')).toBe(CHANNEL_PALETTE.teal);
    expect(channelTypeColor('aux')).toBe(CHANNEL_PALETTE.navy);
    expect(channelTypeColor('mixm')).toBe(CHANNEL_PALETTE.lime);
    expect(channelTypeColor('mtx')).toBe(CHANNEL_PALETTE.purple);
    expect(channelColor('main')).toBe(CHANNEL_PALETTE.red);
    expect(channelColor('main', 'teal')).toBe(CHANNEL_PALETTE.teal);
  });
});
