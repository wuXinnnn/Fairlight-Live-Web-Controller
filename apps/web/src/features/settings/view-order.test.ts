import type { View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import {
  addGroup,
  assignGroup,
  colorForMembership,
  insertChannelAt,
  memberIndices,
  moveChannel,
  moveChannelTo,
  moveGroup,
  moveGroupTo,
  nonEmptyBlocks,
  removeChannel,
  removeGroup,
  removeGroupWithMembers,
  renameGroup,
  rootSlotPositions,
  setGroupColor,
  viewBlocks,
} from './view-order.js';

function ref(name: string, groupId?: string) {
  return groupId === undefined
    ? { kind: 'channel' as const, name }
    : { kind: 'channel' as const, name, groupId };
}

/** A reference that joined a group: an automatic colour becomes "follow the group". */
function joined(name: string, groupId: string) {
  return { ...ref(name, groupId), color: 'group' as const };
}

const view: View = {
  id: 'v',
  name: 'View',
  channels: [ref('A'), ref('B', 'g1'), ref('C', 'g1'), ref('D'), ref('E', 'g2')],
  groups: [
    { id: 'g1', name: 'Rhythm' },
    { id: 'g2', name: 'Vocals' },
    { id: 'g3', name: 'Empty' },
  ],
};

function names(candidate: View | null): string[] {
  return candidate?.channels.map((reference) => reference.name) ?? [];
}

/** Every group's members form one contiguous run and the block count matches. */
function expectContiguousGroups(candidate: View | null): View {
  expect(candidate).not.toBeNull();
  const checked = candidate as View;
  for (const group of checked.groups) {
    const indices = memberIndices(checked, group.id);
    if (indices.length > 0) {
      const first = indices[0] as number;
      const last = indices[indices.length - 1] as number;
      expect(last - first + 1).toBe(indices.length);
    }
  }
  const singles = checked.channels.filter(
    (reference) => !checked.groups.some((group) => group.id === reference.groupId),
  ).length;
  expect(viewBlocks(checked)).toHaveLength(singles + checked.groups.length);
  return checked;
}

describe('viewBlocks', () => {
  it('groups contiguous runs and lists empty groups last', () => {
    expect(viewBlocks(view)).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'group', group: { id: 'g1', name: 'Rhythm' }, indices: [1, 2] },
      { kind: 'single', index: 3 },
      { kind: 'group', group: { id: 'g2', name: 'Vocals' }, indices: [4] },
      { kind: 'group', group: { id: 'g3', name: 'Empty' }, indices: [] },
    ]);
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
    expect(moveChannel(view, 3, 1)).toEqual({
      ...view,
      channels: [ref('A'), ref('B', 'g1'), ref('C', 'g1'), ref('E', 'g2'), ref('D')],
    });
    expect(moveChannel(view, 9, 1)).toBeNull();
  });

  it('refuses to move past an empty group block', () => {
    const trailing: View = { ...view, channels: [ref('A'), ref('E', 'g2')] };
    expect(moveChannel(trailing, 1, 1)).toBeNull();
    expect(moveGroup(trailing, 'g2', 1)).toBeNull();
  });
});

describe('moveGroup', () => {
  it('moves a whole group past the neighbouring block', () => {
    expect(names(moveGroup(view, 'g1', -1))).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(names(moveGroup(view, 'g1', 1))).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(names(moveGroup(view, 'g2', 1))).toEqual([]);
    expect(moveGroup(view, 'g3', -1)).toBeNull();
  });
});

describe('assignGroup', () => {
  it('appends to the target group and keeps the list contiguous', () => {
    const next = assignGroup(view, 0, 'g1');
    expect(names(next)).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(next.channels[2]).toEqual(joined('A', 'g1'));
  });

  it('places a channel first when its group has no members yet', () => {
    expect(names(assignGroup(view, 3, 'g3'))).toEqual(['A', 'B', 'C', 'E', 'D']);
  });

  it('drops a channel right after its former group when ungrouped', () => {
    const next = assignGroup(view, 1, undefined);
    expect(names(next)).toEqual(['A', 'C', 'B', 'D', 'E']);
    expect(next.channels[2]).toEqual(ref('B'));
    expect(names(assignGroup(view, 4, undefined))).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(assignGroup(view, 4, undefined).channels[4]).toEqual(ref('E'));
  });

  it('ignores no-op assignments', () => {
    expect(assignGroup(view, 1, 'g1')).toBe(view);
    expect(assignGroup(view, 0, undefined)).toBe(view);
    expect(assignGroup(view, 9, 'g1')).toBe(view);
  });
});

describe('group management', () => {
  it('adds, renames, and removes groups without losing channels', () => {
    const added = addGroup(view, { id: 'g4', name: 'FX' });
    expect(added.groups.map((group) => group.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(renameGroup(view, 'g1', 'Drums').groups[0]).toEqual({ id: 'g1', name: 'Drums' });
    const removed = removeGroup(view, 'g1');
    expect(removed.groups.map((group) => group.id)).toEqual(['g2', 'g3']);
    expect(removed.channels).toEqual([ref('A'), ref('B'), ref('C'), ref('D'), ref('E', 'g2')]);
  });
});

describe('nonEmptyBlocks and memberIndices', () => {
  it('lists blocks that take part in ordering and the members of a group', () => {
    expect(nonEmptyBlocks(view).map((block) => block.kind)).toEqual([
      'single',
      'group',
      'single',
      'group',
    ]);
    expect(memberIndices(view, 'g1')).toEqual([1, 2]);
    expect(memberIndices(view, 'g3')).toEqual([]);
  });
});

describe('rootSlotPositions', () => {
  const groups = [
    { id: 'g1', name: 'One' },
    { id: 'g2', name: 'Two' },
    { id: 'g3', name: 'Empty' },
  ];
  const layout = (channels: ReturnType<typeof ref>[]): View => ({
    id: 'v',
    name: 'V',
    channels,
    groups,
  });

  it('marks the boundaries where a group starts or ends the list or two groups touch', () => {
    expect(rootSlotPositions(layout([ref('A', 'g1'), ref('B', 'g2')]))).toEqual([0, 1, 2]);
    expect(rootSlotPositions(layout([ref('A'), ref('B', 'g1'), ref('C')]))).toEqual([]);
    expect(rootSlotPositions(layout([ref('A', 'g1'), ref('B')]))).toEqual([0]);
    expect(rootSlotPositions(layout([ref('A'), ref('B', 'g1')]))).toEqual([2]);
    expect(rootSlotPositions(layout([ref('A', 'g1')]))).toEqual([0, 1]);
  });

  it('ignores empty groups and lists without groups', () => {
    expect(rootSlotPositions(layout([ref('A'), ref('B')]))).toEqual([]);
    expect(rootSlotPositions(layout([]))).toEqual([]);
    // g3 has no members: it trails the list as a container only.
    expect(rootSlotPositions(layout([ref('A'), ref('B', 'g1')]))).toEqual([2]);
  });
});

describe('moveChannelTo', () => {
  it('reorders ungrouped channels among the top-level blocks', () => {
    expect(
      names(expectContiguousGroups(moveChannelTo(view, 0, { kind: 'root', position: 1 }))),
    ).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(
      names(expectContiguousGroups(moveChannelTo(view, 3, { kind: 'root', position: 0 }))),
    ).toEqual(['D', 'A', 'B', 'C', 'E']);
    expect(
      names(expectContiguousGroups(moveChannelTo(view, 0, { kind: 'root', position: 3 }))),
    ).toEqual(['B', 'C', 'D', 'E', 'A']);
  });

  it('moves a single into a group at the start, middle and end', () => {
    const first = expectContiguousGroups(
      moveChannelTo(view, 3, { kind: 'group', groupId: 'g1', position: 0 }),
    );
    expect(names(first)).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(first.channels[1]).toEqual(joined('D', 'g1'));
    expect(names(moveChannelTo(view, 3, { kind: 'group', groupId: 'g1', position: 1 }))).toEqual([
      'A',
      'B',
      'D',
      'C',
      'E',
    ]);
    const last = expectContiguousGroups(
      moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 2 }),
    );
    expect(names(last)).toEqual(['B', 'C', 'A', 'D', 'E']);
    expect(last.channels[2]).toEqual(joined('A', 'g1'));
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

  it('moves a member out of its group without leaving a groupId key behind', () => {
    const next = expectContiguousGroups(moveChannelTo(view, 2, { kind: 'root', position: 2 }));
    expect(names(next)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(next.channels[2]).toEqual(ref('C'));
    expect('groupId' in (next.channels[2] as object)).toBe(false);
    expect(names(moveChannelTo(view, 1, { kind: 'root', position: 0 }))).toEqual([
      'B',
      'A',
      'C',
      'D',
      'E',
    ]);
  });

  it('moves a member across groups and into an empty group', () => {
    const across = expectContiguousGroups(
      moveChannelTo(view, 1, { kind: 'group', groupId: 'g2', position: 1 }),
    );
    expect(names(across)).toEqual(['A', 'C', 'D', 'E', 'B']);
    expect(across.channels[4]).toEqual(joined('B', 'g2'));
    const empty = expectContiguousGroups(
      moveChannelTo(view, 4, { kind: 'group', groupId: 'g3', position: 0 }),
    );
    expect(names(empty)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(empty.channels[4]).toEqual(joined('E', 'g3'));
    expect(moveChannelTo(view, 4, { kind: 'group', groupId: 'g3', position: 1 })).toBeNull();
  });

  it('keeps the list contiguous when the only member leaves its group', () => {
    const next = expectContiguousGroups(
      moveChannelTo(view, 4, { kind: 'group', groupId: 'g1', position: 2 }),
    );
    expect(names(next)).toEqual(['A', 'B', 'C', 'E', 'D']);
    expect(viewBlocks(next).at(-1)).toMatchObject({ kind: 'group', indices: [] });
  });

  it('returns null for drops in place, unknown groups and invalid positions', () => {
    expect(moveChannelTo(view, 0, { kind: 'root', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 3, { kind: 'root', position: 2 })).toBeNull();
    expect(moveChannelTo(view, 1, { kind: 'group', groupId: 'g1', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 2, { kind: 'group', groupId: 'g1', position: 1 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'group', groupId: 'nope', position: 0 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'root', position: -1 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'root', position: 4 })).toBeNull();
    expect(moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 3 })).toBeNull();
    expect(moveChannelTo(view, 9, { kind: 'root', position: 0 })).toBeNull();
  });

  it('does not mutate its input', () => {
    const snapshot = structuredClone(view);
    moveChannelTo(view, 0, { kind: 'group', groupId: 'g1', position: 1 });
    expect(view).toEqual(snapshot);
  });
});

describe('insertChannelAt', () => {
  const fresh = { kind: 'channel' as const, name: 'F', channelId: 'channel/6' };

  it('inserts into the root list at the start, middle and end', () => {
    expect(
      names(expectContiguousGroups(insertChannelAt(view, fresh, { kind: 'root', position: 0 }))),
    ).toEqual(['F', 'A', 'B', 'C', 'D', 'E']);
    expect(names(insertChannelAt(view, fresh, { kind: 'root', position: 2 }))).toEqual([
      'A',
      'B',
      'C',
      'F',
      'D',
      'E',
    ]);
    const end = expectContiguousGroups(insertChannelAt(view, fresh, { kind: 'root', position: 4 }));
    expect(names(end)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(end.channels[5]).toEqual(fresh);
  });

  it('inserts into a group and into an empty group', () => {
    const grouped = expectContiguousGroups(
      insertChannelAt(view, fresh, { kind: 'group', groupId: 'g1', position: 1 }),
    );
    expect(names(grouped)).toEqual(['A', 'B', 'F', 'C', 'D', 'E']);
    expect(grouped.channels[2]).toEqual({ ...fresh, groupId: 'g1', color: 'group' });
    const empty = expectContiguousGroups(
      insertChannelAt(view, fresh, { kind: 'group', groupId: 'g3', position: 0 }),
    );
    expect(names(empty)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(empty.channels[5]).toEqual({ ...fresh, groupId: 'g3', color: 'group' });
  });

  it('refuses references that already exist and accepts a different channel id', () => {
    const existing = { kind: 'channel' as const, name: 'A', channelId: 'channel/1' };
    const withIds: View = { ...view, channels: [existing, ...view.channels.slice(1)] };
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
    expect(insertChannelAt(view, fresh, { kind: 'root', position: 5 })).toBeNull();
  });
});

describe('moveGroupTo', () => {
  it('moves a group to the start, end and middle of the top-level blocks', () => {
    expect(names(expectContiguousGroups(moveGroupTo(view, 'g1', 0)))).toEqual([
      'B',
      'C',
      'A',
      'D',
      'E',
    ]);
    expect(names(expectContiguousGroups(moveGroupTo(view, 'g1', 3)))).toEqual([
      'A',
      'D',
      'E',
      'B',
      'C',
    ]);
    expect(names(expectContiguousGroups(moveGroupTo(view, 'g2', 1)))).toEqual([
      'A',
      'E',
      'B',
      'C',
      'D',
    ]);
    expect(names(moveGroupTo(view, 'g1', 2))).toEqual(['A', 'D', 'B', 'C', 'E']);
  });

  it('returns null for drops in place, empty groups, unknown groups and bad positions', () => {
    expect(moveGroupTo(view, 'g1', 1)).toBeNull();
    expect(moveGroupTo(view, 'g3', 0)).toBeNull();
    expect(moveGroupTo(view, 'nope', 0)).toBeNull();
    expect(moveGroupTo(view, 'g1', -1)).toBeNull();
    expect(moveGroupTo(view, 'g1', 4)).toBeNull();
  });
});

describe('removeChannel and removeGroupWithMembers', () => {
  it('removes one reference or a whole group, and rejects unknown targets', () => {
    expect(names(removeChannel(view, 1))).toEqual(['A', 'C', 'D', 'E']);
    expect(removeChannel(view, 9)).toBeNull();
    expect(removeChannel(view, -1)).toBeNull();
    const withoutRhythm = expectContiguousGroups(removeGroupWithMembers(view, 'g1'));
    expect(names(withoutRhythm)).toEqual(['A', 'D', 'E']);
    expect(withoutRhythm.groups.map((group) => group.id)).toEqual(['g2', 'g3']);
    expect(names(removeGroupWithMembers(view, 'g3'))).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(removeGroupWithMembers(view, 'nope')).toBeNull();
    const snapshot = structuredClone(view);
    removeGroupWithMembers(view, 'g1');
    expect(view).toEqual(snapshot);
  });
});

describe('colorForMembership', () => {
  const base = { kind: 'channel' as const, name: 'A' };

  it('follows the group on the way in and lets go on the way out', () => {
    // Automatic becomes "follow the group" when the reference joins one, and back again.
    expect(colorForMembership(base, 'g1')).toEqual({ ...base, groupId: 'g1', color: 'group' });
    expect(colorForMembership({ ...base, groupId: 'g1', color: 'group' }, undefined)).toEqual(base);
    // A colour picked by hand survives both directions.
    expect(colorForMembership({ ...base, color: 'teal' }, 'g1')).toEqual({
      ...base,
      groupId: 'g1',
      color: 'teal',
    });
    expect(colorForMembership({ ...base, groupId: 'g1', color: 'teal' }, undefined)).toEqual({
      ...base,
      color: 'teal',
    });
    // Moving between groups keeps "follow the group"; moving inside one changes nothing.
    expect(colorForMembership({ ...base, groupId: 'g1', color: 'group' }, 'g2')).toEqual({
      ...base,
      groupId: 'g2',
      color: 'group',
    });
    expect(colorForMembership({ ...base, groupId: 'g1' }, 'g1')).toEqual({
      ...base,
      groupId: 'g1',
    });
    // A legacy reference already in a group is only upgraded when it moves to another one.
    expect(colorForMembership({ ...base, groupId: 'g1' }, 'g2')).toEqual({
      ...base,
      groupId: 'g2',
      color: 'group',
    });
  });

  it('always returns a fresh object, which the drag preview relies on', () => {
    const reference = { ...base, groupId: 'g1' };
    expect(colorForMembership(reference, 'g1')).not.toBe(reference);
    const moved = moveChannelTo(view, 1, { kind: 'group', groupId: 'g1', position: 1 });
    expect(moved?.channels).not.toContain(view.channels[1]);
  });
});

describe('colour conversion through the four entry points', () => {
  const coloured: View = {
    id: 'v',
    name: 'View',
    channels: [
      ref('A'),
      { ...ref('B', 'g1'), color: 'group' },
      { ...ref('C', 'g1'), color: 'teal' },
      { ...ref('D'), color: 'navy' },
    ],
    groups: [
      { id: 'g1', name: 'One' },
      { id: 'g2', name: 'Two' },
    ],
  };
  const colours = (next: View | null) => (next?.channels ?? []).map((entry) => entry.color);

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
    // Across groups keeps "follow the group" (g2 is empty, so B lands at the end).
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
    expect(ungrouped.channels[1]?.groupId).toBeUndefined();
    // removeGroupWithMembers takes the references away entirely, so nothing to convert.
    expect(colours(removeGroupWithMembers(coloured, 'g1'))).toEqual([undefined, 'navy']);
  });
});

describe('setGroupColor', () => {
  it('sets and clears the override without touching the other groups', () => {
    const view: View = {
      id: 'v',
      name: 'View',
      channels: [],
      groups: [
        { id: 'g1', name: 'One' },
        { id: 'g2', name: 'Two', color: 'lime' },
      ],
    };
    expect(setGroupColor(view, 'g1', 'purple').groups).toEqual([
      { id: 'g1', name: 'One', color: 'purple' },
      { id: 'g2', name: 'Two', color: 'lime' },
    ]);
    expect(setGroupColor(view, 'g2', undefined).groups).toEqual([
      { id: 'g1', name: 'One' },
      { id: 'g2', name: 'Two' },
    ]);
    expect(setGroupColor(view, 'ghost', 'purple').groups).toEqual(view.groups);
  });
});
