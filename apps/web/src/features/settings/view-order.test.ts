import type { View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import {
  addGroup,
  assignGroup,
  moveChannel,
  moveGroup,
  removeGroup,
  renameGroup,
  viewBlocks,
} from './view-order.js';

function ref(name: string, groupId?: string) {
  return groupId === undefined
    ? { kind: 'channel' as const, name }
    : { kind: 'channel' as const, name, groupId };
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
    expect(next.channels[2]).toEqual(ref('A', 'g1'));
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
