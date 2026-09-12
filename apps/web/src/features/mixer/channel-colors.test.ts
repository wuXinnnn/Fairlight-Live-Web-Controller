import type { ChannelKind } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PALETTE,
  CHANNEL_TYPE_COLORS,
  channelAccent,
  channelColor,
  channelTypeColor,
  dominantChannelKind,
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

  it('takes the kind most of a list is, and the first of a tie', () => {
    expect(dominantChannelKind(['aux'])).toBe('aux');
    expect(dominantChannelKind(['main', 'aux', 'aux'])).toBe('aux');
    // A tie goes to whichever of the tied kinds appears first, so the answer depends only on
    // the list: main here, and aux once the list is turned around.
    expect(dominantChannelKind(['main', 'aux'])).toBe('main');
    expect(dominantChannelKind(['aux', 'main'])).toBe('aux');
    expect(dominantChannelKind(['sub', 'main', 'aux', 'main', 'aux'])).toBe('main');
    expect(dominantChannelKind([])).toBeUndefined();
  });

  it('takes a group colour from its override or the kind most of its members are', () => {
    const members = (...kinds: ChannelKind[]) =>
      kinds.map((kind, index) => ({ kind, name: `C${index}` }));
    const plain = { id: 'g1', name: 'Rhythm', channels: members('aux', 'aux', 'main') };

    expect(groupAccent({ ...plain, color: 'purple' })).toBe(CHANNEL_PALETTE.purple);
    // The override wins over the members; without one the majority decides.
    expect(groupAccent(plain)).toBe(CHANNEL_PALETTE.navy);
    // Members are counted by what their reference says, so a group whose channels are all
    // missing from the mixer still has a settled colour rather than one that shifts about.
    expect(groupAccent({ id: 'g1', name: 'Rhythm', channels: members('main', 'main') })).toBe(
      CHANNEL_PALETTE.red,
    );
    // A member's own colour is deliberately not counted, or it could ask the group to follow it.
    expect(
      groupAccent({
        id: 'g1',
        name: 'Rhythm',
        channels: [{ kind: 'aux', name: 'FX', color: 'lime' }],
      }),
    ).toBe(CHANNEL_PALETTE.navy);
    // A group with no members reads as an input.
    expect(groupAccent({ id: 'g1', name: 'Rhythm', channels: [] })).toBe(CHANNEL_PALETTE.green);
    expect(groupAccent(undefined)).toBe(CHANNEL_PALETTE.green);
  });

  it('resolves a channel colour against its group', () => {
    const channels = [{ kind: 'aux' as const, name: 'FX' }];
    const group = { id: 'g1', name: 'Rhythm', color: 'purple' as const, channels };
    const plain = { id: 'g1', name: 'Rhythm', channels };
    // Automatic and custom colours never look at the group.
    expect(channelAccent('main', undefined, group)).toBe(CHANNEL_PALETTE.red);
    expect(channelAccent('main', 'lime', group)).toBe(CHANNEL_PALETTE.lime);
    // Following the group takes the override, or the group's own answer.
    expect(channelAccent('main', 'group', group)).toBe(CHANNEL_PALETTE.purple);
    expect(channelAccent('main', 'group', plain)).toBe(CHANNEL_PALETTE.navy);
    expect(channelAccent('main', 'group', { id: 'g1', name: 'R', channels: [] })).toBe(
      CHANNEL_PALETTE.green,
    );
    // A saved view can never hold this, but a draft mid-edit falls back to the type colour.
    expect(channelAccent('main', 'group', undefined)).toBe(CHANNEL_PALETTE.red);
  });
});
