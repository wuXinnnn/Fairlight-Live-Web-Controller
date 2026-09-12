import { viewChannelRefs, viewGroups, type View, type ViewChannelRef } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import {
  addGroup,
  appendChannel,
  assignGroup,
  colorForMembership,
  groupOfIndex,
  insertChannelAt,
  locateChannel,
  memberIndices,
  moveChannel,
  moveChannelTo,
  moveGroup,
  moveGroupTo,
  removeChannel,
  removeChannels,
  removeGroup,
  removeGroupWithMembers,
  renameGroup,
  rootSlotPositions,
  setChannelColor,
  setGroupColor,
  viewBlocks,
} from './view-order.js';

function ref(name: string, color?: ViewChannelRef['color']): ViewChannelRef {
  return color === undefined ? { kind: 'channel', name } : { kind: 'channel', name, color };
}

function row(name: string, color?: ViewChannelRef['color']) {
  return { ...ref(name, color), type: 'channel' as const };
}

function group(id: string, name: string, members: ViewChannelRef[] = []) {
  return { type: 'group' as const, id, name, channels: members };
}

/** A reference that joined a group: an automatic colour becomes "follow the group". */
function joined(name: string): ViewChannelRef {
  return ref(name, 'group');
}

function viewOf(items: View['items']): View {
  return { id: 'v', name: 'View', items };
}

// Blocks: A | g1(B, C) | D | g2(E) | g3 (empty, last)
const view = viewOf([
  row('A'),
  group('g1', 'Rhythm', [ref('B'), ref('C')]),
  row('D'),
  group('g2', 'Vocals', [ref('E')]),
  group('g3', 'Empty'),
]);

function names(candidate: View | null): string[] {
  return candidate === null ? [] : viewChannelRefs(candidate).map((entry) => entry.name);
}

function groupIds(candidate: View | null): string[] {
  return candidate === null ? [] : viewGroups(candidate).map((entry) => entry.id);
}

/**
 * The blocks describe the flat channel list exactly: their indices run 0..n-1 in order. Under the
 * items model contiguity is structural — a group owns its members — so this is what is left to
 * check, and it replaces the old contiguity assertion.
 */
function expectConsistentBlocks(candidate: View | null): View {
  expect(candidate).not.toBeNull();
  const checked = candidate as View;
  const indices = viewBlocks(checked).flatMap((block) =>
    block.kind === 'group' ? block.indices : [block.index],
  );
  expect(indices).toEqual(viewChannelRefs(checked).map((_, index) => index));
  expect(viewBlocks(checked)).toHaveLength(checked.items.length);
  return checked;
}

describe('viewBlocks and locateChannel', () => {
  it('turns the items into blocks, keeping an empty group in its place', () => {
    expect(viewBlocks(view)).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'group', group: view.items[1], indices: [1, 2] },
      { kind: 'single', index: 3 },
      { kind: 'group', group: view.items[3], indices: [4] },
      { kind: 'group', group: view.items[4], indices: [] },
    ]);
  });

  it('keeps an empty group where it sits rather than moving it to the end', () => {
    const middle = viewOf([row('A'), group('g3', 'Empty'), row('B')]);
    expect(viewBlocks(middle).map((block) => block.kind)).toEqual(['single', 'group', 'single']);
    expect(viewBlocks(middle)[2]).toEqual({ kind: 'single', index: 1 });
  });

  it('resolves a flat index to the item that holds it', () => {
    expect(locateChannel(view, 0)).toEqual({ item: 0 });
    expect(locateChannel(view, 2)).toEqual({ item: 1, member: 1 });
    expect(locateChannel(view, 3)).toEqual({ item: 2 });
    expect(locateChannel(view, 4)).toEqual({ item: 3, member: 0 });
    expect(locateChannel(view, 5)).toBeNull();
    expect(locateChannel(view, -1)).toBeNull();
    expect(groupOfIndex(view, 1)?.id).toBe('g1');
    expect(groupOfIndex(view, 0)).toBeUndefined();
    expect(groupOfIndex(view, 9)).toBeUndefined();
  });
});

describe('moveChannel', () => {
  it('moves grouped channels only within their group', () => {
    expect(names(moveChannel(view, 2, -1))).toEqual(['A', 'C', 'B', 'D', 'E']);
    expect(moveChannel(view, 1, -1)).toBeNull();
    expect(moveChannel(view, 2, 1)).toBeNull();
  });

  it('steps ungrouped channels over whole blocks', () => {
    expect(names(moveChannel(view, 3, -1))).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(names(moveChannel(view, 0, 1))).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(moveChannel(view, 0, -1)).toBeNull();
    expect(names(moveChannel(view, 3, 1))).toEqual(['A', 'B', 'C', 'E', 'D']);
    expect(moveChannel(view, 9, 1)).toBeNull();
  });

  it('steps over an empty group like any other block', () => {
    // An empty group holds a position now, so the row before it can swap with it and the row
    // lands after it. Version 1 had no position to swap with and refused the move.
    const trailing = viewOf([row('A'), group('g3', 'Empty')]);
    const stepped = moveChannel(trailing, 0, 1);
    expect(stepped?.items.map((item) => item.type)).toEqual(['group', 'channel']);
    expect(moveChannel(trailing, 0, -1)).toBeNull();
  });
});

describe('moveGroup', () => {
  it('moves a whole group past the neighbouring block', () => {
    expect(names(moveGroup(view, 'g1', -1))).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(names(moveGroup(view, 'g1', 1))).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(moveGroup(view, 'nope', -1)).toBeNull();
  });

  it('moves an empty group too', () => {
    const moved = moveGroup(view, 'g3', -1);
    expect(moved?.items.map((item) => (item.type === 'group' ? item.id : 'row'))).toEqual([
      'row',
      'g1',
      'row',
      'g3',
      'g2',
    ]);
    // It is the last block, so there is nothing below it to step over.
    expect(moveGroup(view, 'g3', 1)).toBeNull();
  });
});

describe('assignGroup', () => {
  it('appends to the target group', () => {
    const next = assignGroup(view, 0, 'g1');
    expect(names(next)).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(viewChannelRefs(next)[2]).toEqual(joined('A'));
  });

  it('places a channel first when its group has no members yet', () => {
    expect(names(assignGroup(view, 3, 'g3'))).toEqual(['A', 'B', 'C', 'E', 'D']);
  });

  it('drops a channel right after its former group when ungrouped', () => {
    const next = assignGroup(view, 1, undefined);
    expect(names(next)).toEqual(['A', 'C', 'B', 'D', 'E']);
    expect(viewChannelRefs(next)[2]).toEqual(row('B'));
    expect(names(assignGroup(view, 4, undefined))).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(viewChannelRefs(assignGroup(view, 4, undefined))[4]).toEqual(row('E'));
  });

  it('ignores no-op assignments', () => {
    expect(assignGroup(view, 1, 'g1')).toBe(view);
    expect(assignGroup(view, 0, undefined)).toBe(view);
    expect(assignGroup(view, 9, 'g1')).toBe(view);
    expect(assignGroup(view, 0, 'ghost')).toBe(view);
  });
});

describe('group management', () => {
  it('adds, renames, and removes groups without losing channels', () => {
    const added = addGroup(view, { id: 'g4', name: 'FX' });
    expect(groupIds(added)).toEqual(['g1', 'g2', 'g3', 'g4']);
    // A new group goes to the end of the list, where it is visible and can be filled.
    expect(added.items.at(-1)).toEqual(group('g4', 'FX'));
    expect(viewGroups(renameGroup(view, 'g1', 'Drums'))[0]?.name).toBe('Drums');
    const removed = removeGroup(view, 'g1');
    expect(groupIds(removed)).toEqual(['g2', 'g3']);
    // The members stay exactly where the block was.
    expect(removed.items.slice(0, 3)).toEqual([row('A'), row('B'), row('C')]);
    expect(names(removed)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('removes an empty group by dropping the block alone', () => {
    const removed = removeGroup(view, 'g3');
    expect(groupIds(removed)).toEqual(['g1', 'g2']);
    expect(names(removed)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(removeGroup(view, 'nope')).toBe(view);
  });
});

describe('memberIndices', () => {
  it('lists the flat indices of a group and nothing for an empty one', () => {
    expect(memberIndices(view, 'g1')).toEqual([1, 2]);
    expect(memberIndices(view, 'g2')).toEqual([4]);
    expect(memberIndices(view, 'g3')).toEqual([]);
    expect(memberIndices(view, 'nope')).toEqual([]);
  });
});

describe('rootSlotPositions', () => {
  it('marks the boundaries where a group starts the list or two groups touch', () => {
    // The end of the list has a slot of its own that is always there, so it is not marked here.
    expect(
      rootSlotPositions(viewOf([group('g1', 'One', [ref('A')]), group('g2', 'Two', [ref('B')])])),
    ).toEqual([0, 1]);
    expect(rootSlotPositions(viewOf([row('A'), group('g1', 'One', [ref('B')]), row('C')]))).toEqual(
      [],
    );
    expect(rootSlotPositions(viewOf([group('g1', 'One', [ref('A')]), row('B')]))).toEqual([0]);
    expect(rootSlotPositions(viewOf([row('A'), group('g1', 'One', [ref('B')])]))).toEqual([]);
    expect(rootSlotPositions(viewOf([group('g1', 'One', [ref('A')])]))).toEqual([0]);
  });

  it('counts an empty group as a group and handles lists without any', () => {
    expect(rootSlotPositions(viewOf([row('A'), row('B')]))).toEqual([]);
    expect(rootSlotPositions(viewOf([]))).toEqual([]);
    // An empty group is a block like any other: the row above it already offers its lower half,
    // so that boundary needs no slot, while two groups touching still do.
    expect(rootSlotPositions(viewOf([row('A'), group('g3', 'Empty'), row('B')]))).toEqual([]);
    expect(rootSlotPositions(view)).toEqual([4]);
  });
});

describe('moveChannelTo', () => {
  it('reorders ungrouped channels among the top-level blocks', () => {
    expect(
      names(expectConsistentBlocks(moveChannelTo(view, 0, { kind: 'root', position: 1 }))),
    ).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(
      names(expectConsistentBlocks(moveChannelTo(view, 3, { kind: 'root', position: 0 }))),
    ).toEqual(['D', 'A', 'B', 'C', 'E']);
    expect(
      names(expectConsistentBlocks(moveChannelTo(view, 0, { kind: 'root', position: 3 }))),
    ).toEqual(['B', 'C', 'D', 'E', 'A']);
  });

  it('lands a channel before and after an empty group', () => {
    // g3 is the last block: position 3 puts the row above it, position 4 below it.
    const above = expectConsistentBlocks(moveChannelTo(view, 0, { kind: 'root', position: 3 }));
    expect(above.items.map((item) => (item.type === 'group' ? item.id : 'row'))).toEqual([
      'g1',
      'row',
      'g2',
      'row',
      'g3',
    ]);
    const below = expectConsistentBlocks(moveChannelTo(view, 0, { kind: 'root', position: 4 }));
    expect(below.items.map((item) => (item.type === 'group' ? item.id : 'row'))).toEqual([
      'g1',
      'row',
      'g2',
      'g3',
      'row',
    ]);
    expect(names(below)).toEqual(['B', 'C', 'D', 'E', 'A']);
  });

  it('moves a single into a group at the start, middle and end', () => {
    const first = expectConsistentBlocks(
      moveChannelTo(view, 3, { kind: 'group', groupId: 'g1', position: 0 }),
    );
    expect(names(first)).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(viewChannelRefs(first)[1]).toEqual(joined('D'));
    expect(names(moveChannelTo(view, 3, { kind: 'group', groupId: 'g1', position: 1 }))).toEqual([
      'A',
      'B',
      'D',
      'C',
      'E',
    ]);
    const last = expectConsistentBlocks(
      moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 2 }),
    );
    expect(names(last)).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(viewChannelRefs(last)[2]).toEqual(joined('A'));
  });

  it('moves members within their group', () => {
    expect(names(moveChannelTo(view, 1, { kind: 'group', groupId: 'g1', position: 1 }))).toEqual([
      'A',
      'C',
      'B',
      'D',
      'E',
    ]);
    expect(names(moveChannelTo(view, 2, { kind: 'group', groupId: 'g1', position: 0 }))).toEqual([
      'A',
      'C',
      'B',
      'D',
      'E',
    ]);
  });

  it('moves a member out of its group as a plain root reference', () => {
    const next = expectConsistentBlocks(moveChannelTo(view, 2, { kind: 'root', position: 2 }));
    expect(names(next)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(viewChannelRefs(next)[2]).toEqual({ ...ref('C'), type: 'channel' });
    expect(groupOfIndex(next, 2)).toBeUndefined();
    expect(names(moveChannelTo(view, 1, { kind: 'root', position: 0 }))).toEqual([
      'B',
      'A',
      'C',
      'D',
      'E',
    ]);
  });

  it('moves a member across groups and into an empty group', () => {
    const across = expectConsistentBlocks(
      moveChannelTo(view, 1, { kind: 'group', groupId: 'g2', position: 1 }),
    );
    expect(names(across)).toEqual(['A', 'C', 'D', 'E', 'B']);
    expect(viewChannelRefs(across)[4]).toEqual(joined('B'));
    const empty = expectConsistentBlocks(
      moveChannelTo(view, 4, { kind: 'group', groupId: 'g3', position: 0 }),
    );
    expect(names(empty)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(viewChannelRefs(empty)[4]).toEqual(joined('E'));
    expect(moveChannelTo(view, 4, { kind: 'group', groupId: 'g3', position: 1 })).toBeNull();
  });

  it('leaves an emptied group behind as a block of its own', () => {
    const next = expectConsistentBlocks(
      moveChannelTo(view, 4, { kind: 'group', groupId: 'g1', position: 2 }),
    );
    expect(names(next)).toEqual(['A', 'B', 'C', 'E', 'D']);
    // g2 lost its only member but keeps its position, which is what lets it be dropped on.
    expect(next.items.map((item) => (item.type === 'group' ? item.id : 'row'))).toEqual([
      'row',
      'g1',
      'row',
      'g2',
      'g3',
    ]);
    expect(memberIndices(next, 'g2')).toEqual([]);
  });

  it('returns null for drops in place, unknown groups and invalid positions', () => {
    expect(moveChannelTo(view, 0, { kind: 'root', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 3, { kind: 'root', position: 2 })).toBeNull();
    expect(moveChannelTo(view, 1, { kind: 'group', groupId: 'g1', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 2, { kind: 'group', groupId: 'g1', position: 1 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'group', groupId: 'nope', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'root', position: -1 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'root', position: 5 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 3 })).toBeNull();
    expect(moveChannelTo(view, 9, { kind: 'root', position: 0 })).toBeNull();
  });

  it('does not mutate its input', () => {
    const snapshot = structuredClone(view);
    moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 1 });
    expect(view).toEqual(snapshot);
  });

  it('reports where the reference landed', () => {
    // The drag preview needs the new flat index to keep tracking the row it is moving.
    expect(moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 1 })).not.toBeNull();
    expect(names(moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 1 }))).toEqual([
      'B',
      'A',
      'C',
      'D',
      'E',
    ]);
  });
});

describe('insertChannelAt', () => {
  const fresh = { kind: 'channel' as const, name: 'F', channelId: 'channel/6' };

  it('inserts into the root list at the start, middle and end', () => {
    expect(
      names(expectConsistentBlocks(insertChannelAt(view, fresh, { kind: 'root', position: 0 }))),
    ).toEqual(['F', 'A', 'B', 'C', 'D', 'E']);
    expect(names(insertChannelAt(view, fresh, { kind: 'root', position: 2 }))).toEqual([
      'A',
      'B',
      'C',
      'F',
      'D',
      'E',
    ]);
    const end = expectConsistentBlocks(insertChannelAt(view, fresh, { kind: 'root', position: 5 }));
    expect(names(end)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(viewChannelRefs(end)[5]).toEqual({ ...fresh, type: 'channel' });
  });

  it('inserts before and after an empty group', () => {
    const above = insertChannelAt(view, fresh, { kind: 'root', position: 4 });
    expect(above?.items.at(-1)).toEqual(group('g3', 'Empty'));
    const below = insertChannelAt(view, fresh, { kind: 'root', position: 5 });
    expect(below?.items.at(-1)).toEqual({ ...fresh, type: 'channel' });
  });

  it('inserts into a group and into an empty group', () => {
    const grouped = expectConsistentBlocks(
      insertChannelAt(view, fresh, { kind: 'group', groupId: 'g1', position: 1 }),
    );
    expect(names(grouped)).toEqual(['A', 'B', 'F', 'C', 'D', 'E']);
    expect(viewChannelRefs(grouped)[2]).toEqual({ ...fresh, color: 'group' });
    const empty = expectConsistentBlocks(
      insertChannelAt(view, fresh, { kind: 'group', groupId: 'g3', position: 0 }),
    );
    expect(names(empty)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(viewChannelRefs(empty)[5]).toEqual({ ...fresh, color: 'group' });
  });

  it('refuses references that already exist and accepts a different channel id', () => {
    const existing = { kind: 'channel' as const, name: 'A', channelId: 'channel/1' };
    const withIds = viewOf([{ ...existing, type: 'channel' }, ...view.items.slice(1)]);
    expect(insertChannelAt(withIds, existing, { kind: 'root', position: 0 })).toBeNull();
    expect(
      insertChannelAt(withIds, { ...existing, color: 'red' }, { kind: 'root', position: 0 }),
    ).toBeNull();
    expect(
      names(
        insertChannelAt(
          withIds,
          { ...existing, channelId: 'channel/9' },
          { kind: 'root', position: 0 },
        ),
      ),
    ).toEqual(['A', 'A', 'B', 'C', 'D', 'E']);
    expect(
      insertChannelAt(view, fresh, { kind: 'group', groupId: 'nope', position: 0 }),
    ).toBeNull();
    expect(insertChannelAt(view, fresh, { kind: 'root', position: 6 })).toBeNull();
  });
});

describe('moveGroupTo', () => {
  it('moves a group to the start, end and middle of the top-level blocks', () => {
    expect(names(expectConsistentBlocks(moveGroupTo(view, 'g1', 0)))).toEqual([
      'B',
      'C',
      'A',
      'D',
      'E',
    ]);
    expect(names(expectConsistentBlocks(moveGroupTo(view, 'g1', 4)))).toEqual([
      'A',
      'D',
      'E',
      'B',
      'C',
    ]);
    expect(names(expectConsistentBlocks(moveGroupTo(view, 'g2', 1)))).toEqual([
      'A',
      'E',
      'B',
      'C',
      'D',
    ]);
    expect(names(moveGroupTo(view, 'g1', 2))).toEqual(['A', 'D', 'B', 'C', 'E']);
  });

  it('moves an empty group as readily as any other', () => {
    const moved = moveGroupTo(view, 'g3', 0);
    expect(moved?.items[0]).toEqual(group('g3', 'Empty'));
    expect(names(moved)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('returns null for drops in place, unknown groups and bad positions', () => {
    expect(moveGroupTo(view, 'g1', 1)).toBeNull();
    expect(moveGroupTo(view, 'g3', 4)).toBeNull();
    expect(moveGroupTo(view, 'nope', 0)).toBeNull();
    expect(moveGroupTo(view, 'g1', -1)).toBeNull();
    expect(moveGroupTo(view, 'g1', 5)).toBeNull();
  });
});

describe('removeChannel, removeChannels and removeGroupWithMembers', () => {
  it('removes one reference or a whole group, and rejects unknown targets', () => {
    expect(names(removeChannel(view, 1))).toEqual(['A', 'C', 'D', 'E']);
    expect(removeChannel(view, 9)).toBeNull();
    expect(removeChannel(view, -1)).toBeNull();
    const withoutRhythm = expectConsistentBlocks(removeGroupWithMembers(view, 'g1'));
    expect(names(withoutRhythm)).toEqual(['A', 'D', 'E']);
    expect(groupIds(withoutRhythm)).toEqual(['g2', 'g3']);
    expect(names(removeGroupWithMembers(view, 'g3'))).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(removeGroupWithMembers(view, 'nope')).toBeNull();
    const snapshot = structuredClone(view);
    removeGroupWithMembers(view, 'g1');
    expect(view).toEqual(snapshot);
  });

  it('removes several references at once, wherever they sit', () => {
    // What CLEAR INVALID does: drop every missing reference in one edit.
    expect(names(removeChannels(view, new Set([0, 2, 4])))).toEqual(['B', 'D']);
    expect(removeChannels(view, new Set())).toBe(view);
    // Emptying a group leaves the block in place.
    expect(groupIds(removeChannels(view, new Set([1, 2])))).toEqual(['g1', 'g2', 'g3']);
    expect(memberIndices(removeChannels(view, new Set([1, 2])), 'g1')).toEqual([]);
  });
});

describe('appendChannel and setChannelColor', () => {
  it('appends a reference as the last row of the list', () => {
    const fresh = { kind: 'aux' as const, name: 'FX', channelId: 'aux/1' };
    const next = appendChannel(view, fresh);
    expect(names(next)).toEqual(['A', 'B', 'C', 'D', 'E', 'FX']);
    expect(next.items.at(-1)).toEqual({ ...fresh, type: 'channel' });
  });

  it('sets and clears the colour of a root row and of a member', () => {
    expect(viewChannelRefs(setChannelColor(view, 0, 'teal'))[0]?.color).toBe('teal');
    expect(viewChannelRefs(setChannelColor(view, 1, 'group'))[1]?.color).toBe('group');
    const cleared = setChannelColor(setChannelColor(view, 1, 'teal'), 1, undefined);
    expect(viewChannelRefs(cleared)[1]?.color).toBeUndefined();
    expect('color' in (viewChannelRefs(cleared)[1] as object)).toBe(false);
    // A member must never pick up the root-level `type` key on its way through.
    expect('type' in (viewChannelRefs(setChannelColor(view, 1, 'teal'))[1] as object)).toBe(false);
    expect(setChannelColor(view, 9, 'teal')).toBe(view);
  });
});

describe('colorForMembership', () => {
  const base = ref('A');

  it('follows the group on the way in and lets go on the way out', () => {
    // Automatic becomes "follow the group" when the reference joins one, and back again.
    expect(colorForMembership(base, undefined, 'g1')).toEqual({ ...base, color: 'group' });
    expect(colorForMembership(ref('A', 'group'), 'g1', undefined)).toEqual(base);
    // A colour picked by hand survives both directions.
    expect(colorForMembership(ref('A', 'teal'), undefined, 'g1')).toEqual(ref('A', 'teal'));
    expect(colorForMembership(ref('A', 'teal'), 'g1', undefined)).toEqual(ref('A', 'teal'));
    // Moving between groups keeps "follow the group"; moving inside one changes nothing.
    expect(colorForMembership(ref('A', 'group'), 'g1', 'g2')).toEqual(ref('A', 'group'));
    expect(colorForMembership(base, 'g1', 'g1')).toEqual(base);
    // A legacy reference already in a group is only upgraded when it moves to another one.
    expect(colorForMembership(base, 'g1', 'g2')).toEqual({ ...base, color: 'group' });
  });

  it('always returns a fresh object and never a root item', () => {
    const reference = ref('A');
    expect(colorForMembership(reference, 'g1', 'g1')).not.toBe(reference);
    expect(colorForMembership(row('A'), undefined, 'g1')).toEqual({ ...base, color: 'group' });
    expect('type' in colorForMembership(row('A'), undefined, 'g1')).toBe(false);
  });
});

describe('colour conversion through the four entry points', () => {
  // Blocks: A | g1(B group, C teal) | D navy | g2 (empty)
  const coloured = viewOf([
    row('A'),
    group('g1', 'One', [ref('B', 'group'), ref('C', 'teal')]),
    row('D', 'navy'),
    group('g2', 'Two'),
  ]);
  const colours = (next: View | null) =>
    next === null ? [] : viewChannelRefs(next).map((entry) => entry.color);

  it('converts on assignGroup in both directions', () => {
    // A joins g1 (automatic -> group); D keeps its own colour.
    expect(colours(assignGroup(coloured, 0, 'g1'))).toEqual(['group', 'teal', 'group', 'navy']);
    expect(colours(assignGroup(coloured, 3, 'g1'))).toEqual([undefined, 'group', 'teal', 'navy']);
    // B leaves g1 and reverts to automatic; C keeps teal.
    expect(colours(assignGroup(coloured, 1, undefined))).toEqual([
      undefined,
      'teal',
      undefined,
      'navy',
    ]);
    expect(colours(assignGroup(coloured, 2, undefined))).toEqual([
      undefined,
      'group',
      'teal',
      'navy',
    ]);
  });

  it('converts on moveChannelTo in both directions and leaves same-group moves alone', () => {
    expect(
      colours(moveChannelTo(coloured, 0, { kind: 'group', groupId: 'g1', position: 0 })),
    ).toEqual(['group', 'group', 'teal', 'navy']);
    // Out of the group as an ungrouped row.
    expect(colours(moveChannelTo(coloured, 1, { kind: 'root', position: 0 }))).toEqual([
      undefined,
      undefined,
      'teal',
      'navy',
    ]);
    // Across groups keeps "follow the group" (g2 is empty and last, so B lands at the end).
    expect(
      colours(moveChannelTo(coloured, 1, { kind: 'group', groupId: 'g2', position: 0 })),
    ).toEqual([undefined, 'teal', 'navy', 'group']);
    // Reordering inside the group changes nothing.
    expect(
      colours(moveChannelTo(coloured, 1, { kind: 'group', groupId: 'g1', position: 1 })),
    ).toEqual([undefined, 'teal', 'group', 'navy']);
  });

  it('converts on insertChannelAt', () => {
    const fresh = { kind: 'aux' as const, name: 'FX', channelId: 'aux/1' };
    expect(
      colours(insertChannelAt(coloured, fresh, { kind: 'group', groupId: 'g1', position: 0 })),
    ).toEqual([undefined, 'group', 'group', 'teal', 'navy']);
    expect(colours(insertChannelAt(coloured, fresh, { kind: 'root', position: 0 }))).toEqual([
      undefined,
      undefined,
      'group',
      'teal',
      'navy',
    ]);
  });

  it('converts on removeGroup and leaves other groups alone', () => {
    const ungrouped = removeGroup(coloured, 'g1');
    expect(colours(ungrouped)).toEqual([undefined, undefined, 'teal', 'navy']);
    expect(groupOfIndex(ungrouped, 1)).toBeUndefined();
    // removeGroupWithMembers takes the references away entirely, so nothing to convert.
    expect(colours(removeGroupWithMembers(coloured, 'g1'))).toEqual([undefined, 'navy']);
  });
});

describe('setGroupColor', () => {
  it('sets and clears the override without touching the other groups', () => {
    const palette = viewOf([group('g1', 'One'), { ...group('g2', 'Two'), color: 'lime' as const }]);
    expect(viewGroups(setGroupColor(palette, 'g1', 'purple')).map((entry) => entry.color)).toEqual([
      'purple',
      'lime',
    ]);
    expect(viewGroups(setGroupColor(palette, 'g2', undefined)).map((entry) => entry.color)).toEqual(
      [undefined, undefined],
    );
    expect(setGroupColor(palette, 'ghost', 'purple').items).toEqual(palette.items);
  });
});
