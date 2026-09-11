import type { View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { isViewDirty, sameChannelReference } from './view-dirty.js';

const saved: View = {
  id: 'v',
  name: 'Broadcast',
  channels: [
    { kind: 'channel', name: 'BASS', channelId: 'channel/1', groupId: 'g1' },
    { kind: 'channel', name: 'MAIN', channelId: 'main/1', color: 'red' },
  ],
  groups: [{ id: 'g1', name: 'Rhythm' }],
};

function clone(view: View): View {
  return structuredClone(view);
}

describe('isViewDirty', () => {
  it('treats a structural copy as clean', () => {
    expect(isViewDirty(saved, clone(saved))).toBe(false);
  });

  it('detects a renamed view', () => {
    expect(isViewDirty(saved, { ...clone(saved), name: 'Studio' })).toBe(true);
  });

  it('detects reordered, added and removed channels', () => {
    const draft = clone(saved);
    draft.channels.reverse();
    expect(isViewDirty(saved, draft)).toBe(true);
    expect(isViewDirty(saved, { ...clone(saved), channels: saved.channels.slice(0, 1) })).toBe(
      true,
    );
    expect(
      isViewDirty(saved, {
        ...clone(saved),
        channels: [...saved.channels, { kind: 'aux', name: 'FX' }],
      }),
    ).toBe(true);
  });

  it('detects group membership and color changes', () => {
    const grouped = clone(saved);
    delete grouped.channels[0]?.groupId;
    expect(isViewDirty(saved, grouped)).toBe(true);
    const colored = clone(saved);
    colored.channels[1] = { ...saved.channels[1], color: 'teal' } as View['channels'][number];
    expect(isViewDirty(saved, colored)).toBe(true);
  });

  it('treats a missing key and an undefined value as equal', () => {
    const draft = clone(saved);
    draft.channels[1] = { ...(draft.channels[1] as View['channels'][number]), groupId: undefined };
    expect(isViewDirty(saved, draft)).toBe(false);
    expect(
      sameChannelReference(
        { kind: 'channel', name: 'A', channelId: undefined },
        { kind: 'channel', name: 'A' },
      ),
    ).toBe(true);
  });

  it('detects renamed, added, removed and reordered groups', () => {
    expect(isViewDirty(saved, { ...clone(saved), groups: [{ id: 'g1', name: 'Drums' }] })).toBe(
      true,
    );
    expect(
      isViewDirty(saved, {
        ...clone(saved),
        groups: [...saved.groups, { id: 'g2', name: 'Vocals' }],
      }),
    ).toBe(true);
    expect(isViewDirty(saved, { ...clone(saved), groups: [] })).toBe(true);
    const twoGroups: View = { ...saved, groups: [...saved.groups, { id: 'g2', name: 'Vocals' }] };
    const reordered: View = { ...clone(twoGroups), groups: [...twoGroups.groups].reverse() };
    expect(isViewDirty(twoGroups, reordered)).toBe(true);
    expect(isViewDirty(twoGroups, clone(twoGroups))).toBe(false);
  });

  it('sees a group colour change', () => {
    const saved: View = {
      id: 'v',
      name: 'View',
      channels: [],
      groups: [{ id: 'g1', name: 'Rhythm' }],
    };
    expect(isViewDirty(saved, { ...saved, groups: [{ id: 'g1', name: 'Rhythm' }] })).toBe(false);
    expect(
      isViewDirty(saved, { ...saved, groups: [{ id: 'g1', name: 'Rhythm', color: 'teal' }] }),
    ).toBe(true);
    const coloured: View = { ...saved, groups: [{ id: 'g1', name: 'Rhythm', color: 'teal' }] };
    expect(isViewDirty(coloured, saved)).toBe(true);
    expect(
      isViewDirty(coloured, { ...saved, groups: [{ id: 'g1', name: 'Rhythm', color: 'lime' }] }),
    ).toBe(true);
  });
});
