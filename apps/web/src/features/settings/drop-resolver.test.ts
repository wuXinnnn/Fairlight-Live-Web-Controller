import type { View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { dragSourceFor, resolveDropTarget } from './drop-resolver.js';

function ref(name: string, groupId?: string) {
  return groupId === undefined
    ? { kind: 'channel' as const, name, channelId: `channel/${name}` }
    : { kind: 'channel' as const, name, channelId: `channel/${name}`, groupId };
}

// Blocks: A | g1(B, C) | D | g2(E) | g3 (empty)
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

const row = (name: string) => `channel:channel:${name}:channel/${name}#0`;
const before = { after: false };
const after = { after: true };

describe('dragSourceFor', () => {
  it('maps identifiers to the dragged channel, group or available channel', () => {
    expect(dragSourceFor(view, row('C'))).toEqual({ kind: 'channel', index: 2 });
    expect(dragSourceFor(view, 'group:g1')).toEqual({ kind: 'group', groupId: 'g1' });
    expect(dragSourceFor(view, 'available:aux/1')).toEqual({
      kind: 'available',
      channelId: 'aux/1',
    });
    expect(dragSourceFor(view, row('Z'))).toBeNull();
    expect(dragSourceFor(view, 'groupzone:g1')).toBeNull();
    expect(dragSourceFor(view, 'bogus')).toBeNull();
  });
});

describe('resolveDropTarget', () => {
  it('lands before or after the row it is over inside the same list', () => {
    // Positions count the blocks and members without the dragged row: A | g1(B, C) | D | g2(E)
    // becomes g1(B, C) | D | g2(E) while A is dragged, so D's upper half is root position 1.
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, row('D'), before)).toEqual({ kind: 'root', position: 1 });
    expect(resolveDropTarget(view, a, row('D'), after)).toEqual({ kind: 'root', position: 2 });
    const d = { kind: 'channel', index: 3 } as const;
    expect(resolveDropTarget(view, d, row('A'), before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, d, row('A'), after)).toEqual({ kind: 'root', position: 1 });
    const b = { kind: 'channel', index: 1 } as const;
    expect(resolveDropTarget(view, b, row('C'), before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 0,
    });
    expect(resolveDropTarget(view, b, row('C'), after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
    const c = { kind: 'channel', index: 2 } as const;
    expect(resolveDropTarget(view, c, row('B'), before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 0,
    });
    expect(resolveDropTarget(view, c, row('B'), after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
  });

  it('lands before or after the row when crossing lists', () => {
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, row('C'), before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
    expect(resolveDropTarget(view, a, row('C'), after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 2,
    });
    const c = { kind: 'channel', index: 2 } as const;
    expect(resolveDropTarget(view, c, row('D'), before)).toEqual({ kind: 'root', position: 2 });
    expect(resolveDropTarget(view, c, row('D'), after)).toEqual({ kind: 'root', position: 3 });
    expect(resolveDropTarget(view, c, row('E'), before)).toEqual({
      kind: 'group',
      groupId: 'g2',
      position: 0,
    });
    // E is the only member of g2: once removed, D's block index shifts by nothing but g2 vanishes.
    const e = { kind: 'channel', index: 4 } as const;
    expect(resolveDropTarget(view, e, row('A'), before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, e, row('D'), after)).toEqual({ kind: 'root', position: 3 });
  });

  it('puts a channel first or last in a group container and refuses containers for group drags', () => {
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, 'groupzone:g1', before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 0,
    });
    expect(resolveDropTarget(view, a, 'groupzone:g1', after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 2,
    });
    expect(resolveDropTarget(view, a, 'groupzone:g3', before)).toEqual({
      kind: 'group',
      groupId: 'g3',
      position: 0,
    });
    expect(resolveDropTarget(view, a, 'groupzone:g3', after)).toEqual({
      kind: 'group',
      groupId: 'g3',
      position: 0,
    });
    const b = { kind: 'channel', index: 1 } as const;
    expect(resolveDropTarget(view, b, 'groupzone:g1', after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
    expect(resolveDropTarget(view, a, 'groupzone:nope', before)).toBeNull();
    expect(
      resolveDropTarget(view, { kind: 'group', groupId: 'g1' }, 'groupzone:g2', before),
    ).toBeNull();
  });

  it('places available channels like a cross-list drop', () => {
    const fx = { kind: 'available', channelId: 'aux/1' } as const;
    expect(resolveDropTarget(view, fx, row('A'), before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, fx, row('A'), after)).toEqual({ kind: 'root', position: 1 });
    expect(resolveDropTarget(view, fx, row('B'), after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
    expect(resolveDropTarget(view, fx, 'groupzone:g2', before)).toEqual({
      kind: 'group',
      groupId: 'g2',
      position: 0,
    });
    expect(resolveDropTarget(view, fx, 'groupzone:g2', after)).toEqual({
      kind: 'group',
      groupId: 'g2',
      position: 1,
    });
  });

  it('places channels at the root slot they are dropped on', () => {
    // Blocks: A | g1(B, C) | D | g2(E). Slot positions count the blocks without the dragged
    // channel, so they pass through unchanged as long as they exist in that view.
    const a = { kind: 'channel', index: 0 } as const;
    const c = { kind: 'channel', index: 2 } as const;
    const fx = { kind: 'available', channelId: 'aux/1' } as const;
    expect(resolveDropTarget(view, a, 'slot:0', before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, a, 'slot:3', before)).toEqual({ kind: 'root', position: 3 });
    // Without A there are three blocks, so position 4 does not exist.
    expect(resolveDropTarget(view, a, 'slot:4', before)).toBeNull();
    expect(resolveDropTarget(view, c, 'slot:4', after)).toEqual({ kind: 'root', position: 4 });
    expect(resolveDropTarget(view, fx, 'slot:0', before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, fx, 'slot:4', before)).toEqual({ kind: 'root', position: 4 });
    expect(resolveDropTarget(view, fx, 'slot:5', before)).toBeNull();
    expect(resolveDropTarget(view, { kind: 'group', groupId: 'g1' }, 'slot:0', before)).toBeNull();
  });

  it('moves groups before or after root rows and other groups only', () => {
    // Without g1 the blocks are A | D | g2(E).
    const g1 = { kind: 'group', groupId: 'g1' } as const;
    expect(resolveDropTarget(view, g1, row('D'), before)).toEqual({ kind: 'root', position: 1 });
    expect(resolveDropTarget(view, g1, row('D'), after)).toEqual({ kind: 'root', position: 2 });
    expect(resolveDropTarget(view, g1, 'group:g2', before)).toEqual({ kind: 'root', position: 2 });
    expect(resolveDropTarget(view, g1, 'group:g2', after)).toEqual({ kind: 'root', position: 3 });
    const g2 = { kind: 'group', groupId: 'g2' } as const;
    expect(resolveDropTarget(view, g2, row('A'), before)).toEqual({ kind: 'root', position: 0 });
    expect(resolveDropTarget(view, g2, 'group:g1', after)).toEqual({ kind: 'root', position: 2 });
    expect(resolveDropTarget(view, g1, row('E'), before)).toBeNull();
    expect(resolveDropTarget(view, g1, 'group:g1', before)).toBeNull();
    expect(resolveDropTarget(view, g1, 'group:g3', before)).toBeNull();
    expect(resolveDropTarget(view, { kind: 'channel', index: 0 }, 'group:g1', before)).toBeNull();
  });

  it('returns null for unknown, stale or self targets', () => {
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, row('A'), before)).toBeNull();
    expect(resolveDropTarget(view, a, row('Z'), before)).toBeNull();
    expect(resolveDropTarget(view, a, 'available:aux/1', before)).toBeNull();
    expect(resolveDropTarget(view, a, 'bogus', before)).toBeNull();
  });
});
