import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PALETTE,
  CHANNEL_TYPE_COLORS,
  channelAccent,
  channelColor,
  channelTypeColor,
  groupAccent,
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

  it('takes a group colour from its override or its first present member', () => {
    const plain = { id: 'g1', name: 'Rhythm' };
    expect(groupAccent({ ...plain, color: 'purple' }, 'channel')).toBe(CHANNEL_PALETTE.purple);
    // The override wins even when the lead kind says otherwise, and without one the lead decides.
    expect(groupAccent(plain, 'aux')).toBe(CHANNEL_PALETTE.navy);
    // A group with nothing present in it reads as an input.
    expect(groupAccent(plain, undefined)).toBe(CHANNEL_PALETTE.green);
    expect(groupAccent(undefined, 'main')).toBe(CHANNEL_PALETTE.red);
  });

  it('resolves a channel colour against its group', () => {
    const group = { id: 'g1', name: 'Rhythm', color: 'purple' } as const;
    const plain = { id: 'g1', name: 'Rhythm' };
    // Automatic and custom colours never look at the group.
    expect(channelAccent('main', undefined, group, 'aux')).toBe(CHANNEL_PALETTE.red);
    expect(channelAccent('main', 'lime', group, 'aux')).toBe(CHANNEL_PALETTE.lime);
    // Following the group takes the override, or the group's own lead kind.
    expect(channelAccent('main', 'group', group, 'aux')).toBe(CHANNEL_PALETTE.purple);
    expect(channelAccent('main', 'group', plain, 'aux')).toBe(CHANNEL_PALETTE.navy);
    expect(channelAccent('main', 'group', plain, undefined)).toBe(CHANNEL_PALETTE.green);
    // A saved view can never hold this, but a draft mid-edit falls back to the type colour.
    expect(channelAccent('main', 'group', undefined)).toBe(CHANNEL_PALETTE.red);
  });
});
