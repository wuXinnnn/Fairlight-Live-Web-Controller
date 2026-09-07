import type { Active, ClientRect, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';
import {
  isEligibleTarget,
  viewCollisionDetection,
  viewKeyboardCoordinates,
} from './dnd-collision.js';
import type { DndItemData } from './dnd-ids.js';

function rect(top: number, height = 40, left = 500, width = 400): ClientRect {
  return { top, left, width, height, bottom: top + height, right: left + width };
}

interface Fixture {
  containers: DroppableContainer[];
  rects: Map<UniqueIdentifier, ClientRect>;
}

function fixture(entries: Array<[string, DndItemData, ClientRect]>): Fixture {
  const rects = new Map<UniqueIdentifier, ClientRect>();
  const containers = entries.map(([id, data, box]) => {
    rects.set(id, box);
    return {
      id,
      key: id,
      disabled: false,
      node: { current: null },
      rect: { current: box },
      data: { current: data },
    } as unknown as DroppableContainer;
  });
  return { containers, rects };
}

function active(id: string, data: DndItemData): Active {
  return { id, data: { current: data }, rect: { current: { initial: null, translated: null } } };
}

// A | g1(B, C) | g3 (empty): the group container spans its header and members.
const list = fixture([
  ['channel:a', { kind: 'channel', label: 'A' }, rect(0)],
  ['group:g1', { kind: 'group', label: 'group Rhythm', groupId: 'g1' }, rect(40, 120)],
  [
    'groupzone:g1',
    { kind: 'groupzone', label: 'group Rhythm', groupId: 'g1', empty: false },
    rect(40, 120),
  ],
  ['channel:b', { kind: 'channel', label: 'B', groupId: 'g1' }, rect(80)],
  ['channel:c', { kind: 'channel', label: 'C', groupId: 'g1' }, rect(120)],
  [
    'groupzone:g3',
    { kind: 'groupzone', label: 'group Empty', groupId: 'g3', empty: true },
    rect(160, 80),
  ],
  ['available:aux/1', { kind: 'available', label: 'FX', channelId: 'aux/1' }, rect(0, 40, 0)],
]);

describe('isEligibleTarget', () => {
  it('lets channels land on rows and containers, and groups on root rows and groups', () => {
    expect(isEligibleTarget('channel', { kind: 'channel', label: 'B', groupId: 'g1' })).toBe(true);
    expect(
      isEligibleTarget('available', { kind: 'groupzone', label: 'g', groupId: 'g1', empty: false }),
    ).toBe(true);
    expect(isEligibleTarget('channel', { kind: 'group', label: 'g', groupId: 'g1' })).toBe(false);
    expect(isEligibleTarget('group', { kind: 'channel', label: 'A' })).toBe(true);
    expect(isEligibleTarget('group', { kind: 'channel', label: 'B', groupId: 'g1' })).toBe(false);
    expect(isEligibleTarget('group', { kind: 'group', label: 'g', groupId: 'g2' })).toBe(true);
    expect(
      isEligibleTarget('group', { kind: 'groupzone', label: 'g', groupId: 'g1', empty: true }),
    ).toBe(false);
    expect(isEligibleTarget('groupzone', { kind: 'channel', label: 'A' })).toBe(false);
  });
});

describe('viewCollisionDetection', () => {
  const channelA = active('channel:a', { kind: 'channel', label: 'A' });

  it('uses the pointer position, preferring rows over the container around them', () => {
    const ids = (pointer: { x: number; y: number }) =>
      viewCollisionDetection({
        active: channelA,
        collisionRect: rect(0),
        droppableRects: list.rects,
        droppableContainers: list.containers,
        pointerCoordinates: pointer,
      }).map((collision) => collision.id);
    expect(ids({ x: 600, y: 100 })).toEqual(['channel:b']);
    expect(ids({ x: 600, y: 60 })).toEqual(['groupzone:g1']);
    expect(ids({ x: 600, y: 200 })).toEqual(['groupzone:g3']);
    expect(ids({ x: 100, y: 20 })).toEqual([]);
  });

  it('uses the nearest centre for keyboard drags, ignoring populated containers', () => {
    const ids = viewCollisionDetection({
      active: channelA,
      collisionRect: rect(80),
      droppableRects: list.rects,
      droppableContainers: list.containers,
      pointerCoordinates: null,
    }).map((collision) => collision.id);
    expect(ids[0]).toBe('channel:b');
    expect(ids).not.toContain('groupzone:g1');
    expect(ids).not.toContain('group:g1');
  });

  it('offers only root rows and groups to a dragged group', () => {
    const ids = viewCollisionDetection({
      active: active('group:g1', { kind: 'group', label: 'group Rhythm', groupId: 'g1' }),
      collisionRect: rect(40, 120),
      droppableRects: list.rects,
      droppableContainers: list.containers,
      pointerCoordinates: null,
    }).map((collision) => collision.id);
    expect(ids.sort()).toEqual(['channel:a', 'group:g1']);
  });

  it('returns nothing for an active without item data', () => {
    expect(
      viewCollisionDetection({
        active: {
          id: 'x',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        },
        collisionRect: rect(0),
        droppableRects: list.rects,
        droppableContainers: list.containers,
        pointerCoordinates: null,
      }),
    ).toEqual([]);
  });
});

describe('viewKeyboardCoordinates', () => {
  function move(
    code: string,
    activeId: string,
    data: DndItemData,
    collisionRect: ClientRect,
    over: { id: UniqueIdentifier } | null = { id: 'self' },
  ) {
    const event = { code, preventDefault: () => undefined } as unknown as KeyboardEvent;
    const byId = new Map(list.containers.map((container) => [container.id, container]));
    return viewKeyboardCoordinates(event, {
      active: activeId,
      currentCoordinates: { x: collisionRect?.left ?? 0, y: collisionRect?.top ?? 0 },
      context: {
        active: active(activeId, data),
        collisionRect,
        droppableRects: list.rects,
        droppableContainers: {
          get: (id: UniqueIdentifier) => byId.get(id),
          getEnabled: () => list.containers,
        },
        over,
      } as never,
    });
  }

  it('centres the dragged row on the next eligible target above or below', () => {
    const a: DndItemData = { kind: 'channel', label: 'A' };
    expect(move('ArrowDown', 'channel:a', a, rect(0))).toEqual({ x: 500, y: 80 });
    expect(move('ArrowDown', 'channel:a', a, rect(80))).toEqual({ x: 500, y: 120 });
    expect(move('ArrowDown', 'channel:a', a, rect(120))).toEqual({ x: 500, y: 180 });
    expect(move('ArrowDown', 'channel:a', a, rect(180))).toBeUndefined();
    expect(move('ArrowUp', 'channel:a', a, rect(120))).toEqual({ x: 500, y: 80 });
    expect(move('ArrowLeft', 'channel:a', a, rect(0))).toBeUndefined();
    expect(move('Space', 'channel:a', a, rect(0))).toBeUndefined();
  });

  it('keeps a tall group block centred on short rows', () => {
    const g1: DndItemData = { kind: 'group', label: 'group Rhythm', groupId: 'g1' };
    expect(move('ArrowUp', 'group:g1', g1, rect(40, 120))).toEqual({ x: 500, y: -40 });
    expect(move('ArrowDown', 'group:g1', g1, rect(40, 120))).toBeUndefined();
  });

  it('jumps an available channel to its first or last target', () => {
    const fx: DndItemData = { kind: 'available', label: 'FX', channelId: 'aux/1' };
    expect(move('ArrowDown', 'available:aux/1', fx, rect(0, 40, 0), null)).toEqual({
      x: 500,
      y: 0,
    });
    expect(move('ArrowUp', 'available:aux/1', fx, rect(0, 40, 0), null)).toEqual({
      x: 500,
      y: 180,
    });
    expect(move('ArrowRight', 'available:aux/1', fx, rect(0, 40, 0), { id: 'channel:a' })).toEqual({
      x: 500,
      y: 80,
    });
  });

  it('does nothing without geometry or item data', () => {
    const a: DndItemData = { kind: 'channel', label: 'A' };
    expect(move('ArrowDown', 'channel:a', a, null as unknown as ClientRect)).toBeUndefined();
    expect(move('ArrowDown', 'unknown', { kind: 'channel', label: 'x' }, rect(0))).toEqual({
      x: 500,
      y: 80,
    });
  });
});
