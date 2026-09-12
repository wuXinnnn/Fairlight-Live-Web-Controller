import type { View, ViewChannelRef, ViewItem } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { isViewDirty, sameChannelReference, sameViewItems } from './view-dirty.js';

function group(id: string, name: string, members: ViewChannelRef[] = []): ViewItem {
  return { type: 'group', id, name, channels: members };
}

const saved: View = {
  id: 'v',
  name: 'Broadcast',
  items: [
    group('g1', 'Rhythm', [{ kind: 'channel', name: 'BASS', channelId: 'channel/1' }]),
    { type: 'channel', kind: 'channel', name: 'MAIN', channelId: 'main/1', color: 'red' },
  ],
};

function clone(view: View): View {
  return structuredClone(view);
}

function withItems(items: ViewItem[]): View {
  return { ...clone(saved), items };
}

describe('isViewDirty', () => {
  it('treats a structural copy as clean', () => {
    expect(isViewDirty(saved, clone(saved))).toBe(false);
  });

  it('detects a renamed view', () => {
    expect(isViewDirty(saved, { ...clone(saved), name: 'Studio' })).toBe(true);
  });

  it('detects reordered, added and removed channels', () => {
    expect(isViewDirty(saved, withItems([...clone(saved).items].reverse()))).toBe(true);
    expect(isViewDirty(saved, withItems(clone(saved).items.slice(0, 1)))).toBe(true);
    expect(
      isViewDirty(
        saved,
        withItems([...clone(saved).items, { type: 'channel', kind: 'aux', name: 'FX' }]),
      ),
    ).toBe(true);
  });

  it('detects group membership and colour changes', () => {
    // BASS leaves its group and becomes a root row: same reference, different structure.
    expect(
      isViewDirty(
        saved,
        withItems([
          group('g1', 'Rhythm'),
          { type: 'channel', kind: 'channel', name: 'BASS', channelId: 'channel/1' },
          clone(saved).items[1] as ViewItem,
        ]),
      ),
    ).toBe(true);
    const coloured = clone(saved);
    coloured.items[1] = { ...(coloured.items[1] as ViewItem), color: 'teal' } as ViewItem;
    expect(isViewDirty(saved, coloured)).toBe(true);
    // A member's colour counts as much as a root row's.
    expect(
      isViewDirty(
        saved,
        withItems([
          group('g1', 'Rhythm', [
            { kind: 'channel', name: 'BASS', channelId: 'channel/1', color: 'group' },
          ]),
          clone(saved).items[1] as ViewItem,
        ]),
      ),
    ).toBe(true);
  });

  it('treats a missing key and an undefined value as equal', () => {
    const draft = clone(saved);
    draft.items[1] = { ...(draft.items[1] as ViewItem), color: 'red' } as ViewItem;
    expect(isViewDirty(saved, draft)).toBe(false);
    expect(
      sameChannelReference(
        { kind: 'channel', name: 'A', channelId: undefined },
        { kind: 'channel', name: 'A' },
      ),
    ).toBe(true);
  });

  it('detects renamed, added, removed and reordered groups', () => {
    expect(
      isViewDirty(saved, withItems([group('g1', 'Drums'), clone(saved).items[1] as ViewItem])),
    ).toBe(true);
    expect(isViewDirty(saved, withItems([...clone(saved).items, group('g2', 'Vocals')]))).toBe(
      true,
    );
    expect(isViewDirty(saved, withItems([clone(saved).items[1] as ViewItem]))).toBe(true);
    const two = withItems([...clone(saved).items, group('g2', 'Vocals')]);
    const reordered = { ...two, items: [...two.items].reverse() };
    expect(isViewDirty(two, reordered)).toBe(true);
    expect(isViewDirty(two, clone(two))).toBe(false);
  });

  it('sees an empty group move even though no channel went anywhere', () => {
    const before: View = {
      id: 'v',
      name: 'View',
      items: [{ type: 'channel', kind: 'main', name: 'Main' }, group('g1', 'Rhythm')],
    };
    const after: View = { ...before, items: [...before.items].reverse() };
    expect(isViewDirty(before, after)).toBe(true);
    expect(isViewDirty(before, clone(before))).toBe(false);
    expect(sameViewItems(before, after)).toBe(false);
  });

  it('sees a group colour change', () => {
    const plain: View = { id: 'v', name: 'View', items: [group('g1', 'Rhythm')] };
    expect(isViewDirty(plain, { ...plain, items: [group('g1', 'Rhythm')] })).toBe(false);
    const coloured: View = {
      ...plain,
      items: [{ ...(group('g1', 'Rhythm') as ViewItem), color: 'teal' } as ViewItem],
    };
    expect(isViewDirty(plain, coloured)).toBe(true);
    expect(isViewDirty(coloured, plain)).toBe(true);
    expect(
      isViewDirty(coloured, {
        ...plain,
        items: [{ ...(group('g1', 'Rhythm') as ViewItem), color: 'lime' } as ViewItem],
      }),
    ).toBe(true);
  });

  it('sees a row become a group and back', () => {
    const asRow: View = {
      id: 'v',
      name: 'View',
      items: [{ type: 'channel', kind: 'main', name: 'Main' }],
    };
    const asGroup: View = { ...asRow, items: [group('main', 'Main')] };
    expect(isViewDirty(asRow, asGroup)).toBe(true);
    expect(isViewDirty(asGroup, asRow)).toBe(true);
  });
});
