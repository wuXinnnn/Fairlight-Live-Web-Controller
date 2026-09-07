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
  it('takes the slot of the row it is over inside the same list', () => {
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, row('D'), before)).toEqual({ kind: 'root', position: 2 });
    const d = { kind: 'channel', index: 3 } as const;
    expect(resolveDropTarget(view, d, row('A'), after)).toEqual({ kind: 'root', position: 0 });
    const b = { kind: 'channel', index: 1 } as const;
    expect(resolveDropTarget(view, b, row('C'), before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 1,
    });
    const c = { kind: 'channel', index: 2 } as const;
    expect(resolveDropTarget(view, c, row('B'), after)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 0,
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

  it('appends to a group container and refuses containers for group drags', () => {
    const a = { kind: 'channel', index: 0 } as const;
    expect(resolveDropTarget(view, a, 'groupzone:g1', before)).toEqual({
      kind: 'group',
      groupId: 'g1',
      position: 2,
    });
    expect(resolveDropTarget(view, a, 'groupzone:g3', before)).toEqual({
      kind: 'group',
      groupId: 'g3',
      position: 0,
    });
    const b = { kind: 'channel', index: 1 } as const;
    expect(resolveDropTarget(view, b, 'groupzone:g1', before)).toEqual({
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
      position: 1,
    });
  });

  it('moves groups over root rows and other groups only', () => {
    const g1 = { kind: 'group', groupId: 'g1' } as const;
    expect(resolveDropTarget(view, g1, row('D'), before)).toEqual({ kind: 'root', position: 2 });
    expect(resolveDropTarget(view, g1, 'group:g2', before)).toEqual({ kind: 'root', position: 3 });
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
