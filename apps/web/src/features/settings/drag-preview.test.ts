import type { ChannelState, View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { defaultDropAnimation } from '@dnd-kit/core';
import { DROP_ANIMATION_MS } from './dnd-config.js';
import {
  containerOf,
  containerOfTarget,
  dropAnimationFor,
  dropHintFor,
  eventPoint,
  pointerOutside,
  previewFor,
  removalFor,
  sameContainer,
  settlePreview,
} from './drag-preview.js';

function ref(name: string, groupId?: string) {
  return groupId === undefined
    ? { kind: 'channel' as const, name, channelId: `channel/${name}` }
    : { kind: 'channel' as const, name, channelId: `channel/${name}`, groupId };
}

// A | g1(B, C) | D | g3 (empty)
const view: View = {
  id: 'v',
  name: 'View',
  channels: [ref('A'), ref('B', 'g1'), ref('C', 'g1'), ref('D')],
  groups: [
    { id: 'g1', name: 'Rhythm' },
    { id: 'g3', name: 'Empty' },
  ],
};

const fx: ChannelState = {
  id: 'aux/1',
  kind: 'aux',
  name: 'FX',
  levelDb: 0,
  muted: false,
  meterDb: -60,
};

const names = (candidate: View) => candidate.channels.map((reference) => reference.name);

describe('containers', () => {
  it('locates the dragged item and compares containers', () => {
    expect(containerOf(view, { kind: 'channel', index: 0 })).toEqual({ kind: 'root' });
    expect(containerOf(view, { kind: 'channel', index: 1 })).toEqual({
      kind: 'group',
      groupId: 'g1',
    });
    expect(containerOf(view, { kind: 'channel', index: 9 })).toBeNull();
    expect(containerOf(view, { kind: 'group', groupId: 'g1' })).toEqual({ kind: 'root' });
    expect(containerOf(view, { kind: 'available', channelId: 'aux/1' })).toBeNull();
    expect(containerOfTarget({ kind: 'root', position: 1 })).toEqual({ kind: 'root' });
    expect(containerOfTarget({ kind: 'group', groupId: 'g1', position: 0 })).toEqual({
      kind: 'group',
      groupId: 'g1',
    });
    expect(sameContainer({ kind: 'root' }, { kind: 'root' })).toBe(true);
    expect(sameContainer({ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g1' })).toBe(
      true,
    );
    expect(sameContainer({ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g3' })).toBe(
      false,
    );
    expect(sameContainer({ kind: 'root' }, { kind: 'group', groupId: 'g1' })).toBe(false);
    expect(sameContainer(null, null)).toBe(true);
    expect(sameContainer(null, { kind: 'root' })).toBe(false);
  });
});

describe('previewFor', () => {
  it('moves a channel and reports where it landed', () => {
    const preview = previewFor(
      view,
      { kind: 'channel', index: 0 },
      { kind: 'group', groupId: 'g1', position: 1 },
    );
    expect(preview).not.toBeNull();
    expect(names(preview?.view as View)).toEqual(['B', 'A', 'C', 'D']);
    expect(preview?.source).toEqual({ kind: 'channel', index: 1 });
    expect(preview?.placeholderChannelId).toBeUndefined();
    expect(
      previewFor(view, { kind: 'channel', index: 0 }, { kind: 'root', position: 0 }),
    ).toBeNull();
  });

  it('moves a group only within the root list', () => {
    const preview = previewFor(
      view,
      { kind: 'group', groupId: 'g1' },
      { kind: 'root', position: 2 },
    );
    expect(names(preview?.view as View)).toEqual(['A', 'D', 'B', 'C']);
    expect(preview?.source).toEqual({ kind: 'group', groupId: 'g1' });
    expect(
      previewFor(
        view,
        { kind: 'group', groupId: 'g1' },
        { kind: 'group', groupId: 'g3', position: 0 },
      ),
    ).toBeNull();
    expect(
      previewFor(view, { kind: 'group', groupId: 'g1' }, { kind: 'root', position: 1 }),
    ).toBeNull();
  });

  it('inserts an available channel as a placeholder', () => {
    const preview = previewFor(
      view,
      { kind: 'available', channelId: 'aux/1' },
      { kind: 'group', groupId: 'g3', position: 0 },
      fx,
    );
    expect(names(preview?.view as View)).toEqual(['A', 'B', 'C', 'D', 'FX']);
    expect(preview?.view.channels[4]).toEqual({
      kind: 'aux',
      name: 'FX',
      channelId: 'aux/1',
      groupId: 'g3',
    });
    expect(preview?.source).toEqual({ kind: 'channel', index: 4 });
    expect(preview?.placeholderChannelId).toBe('aux/1');
    expect(
      previewFor(view, { kind: 'available', channelId: 'aux/1' }, { kind: 'root', position: 0 }),
    ).toBeNull();
  });
});

describe('removalFor', () => {
  it('removes a channel, a group with its members, and nothing for available channels', () => {
    expect(names(removalFor(view, { kind: 'channel', index: 2 }) as View)).toEqual(['A', 'B', 'D']);
    const withoutGroup = removalFor(view, { kind: 'group', groupId: 'g1' }) as View;
    expect(names(withoutGroup)).toEqual(['A', 'D']);
    expect(withoutGroup.groups.map((group) => group.id)).toEqual(['g3']);
    expect(removalFor(view, { kind: 'group', groupId: 'nope' })).toBeNull();
    expect(removalFor(view, { kind: 'channel', index: 9 })).toBeNull();
    expect(removalFor(view, { kind: 'available', channelId: 'aux/1' })).toBeNull();
  });
});

describe('pointer helpers', () => {
  it('reads the viewport position of pointer events only', () => {
    const mouse = new MouseEvent('pointerdown', { clientX: 100, clientY: 200 });
    expect(eventPoint(mouse)).toEqual({ x: 100, y: 200 });
    expect(eventPoint(new KeyboardEvent('keydown', { code: 'Space' }))).toBeNull();
    expect(eventPoint(null)).toBeNull();
  });

  it('detects a pointer beyond the threshold on any side', () => {
    const box = { top: 100, left: 100, right: 500, bottom: 500 };
    expect(pointerOutside({ x: 300, y: 300 }, box, 64)).toBe(false);
    expect(pointerOutside({ x: 40, y: 300 }, box, 64)).toBe(false);
    expect(pointerOutside({ x: 35, y: 300 }, box, 64)).toBe(true);
    expect(pointerOutside({ x: 565, y: 300 }, box, 64)).toBe(true);
    expect(pointerOutside({ x: 300, y: 35 }, box, 64)).toBe(true);
    expect(pointerOutside({ x: 300, y: 565 }, box, 64)).toBe(true);
    expect(pointerOutside({ x: 300, y: 564 }, box, 64)).toBe(false);
  });
});

describe('settlePreview', () => {
  // A previewed at the start of g1: g1(A, B, C) | D
  const preview = previewFor(
    view,
    { kind: 'channel', index: 0 },
    { kind: 'group', groupId: 'g1', position: 0 },
  ) as NonNullable<ReturnType<typeof previewFor>>;
  const activeId = 'channel:channel:A:channel/A#0';
  const hint = { after: false };

  it('keeps the preview when the item is released over itself', () => {
    expect(settlePreview(preview, activeId, activeId, hint)).toBe(preview.view);
  });

  it('keeps the previewed slot when the item is released over the group it already sits in', () => {
    expect(settlePreview(preview, activeId, 'groupzone:g1', hint)).toBe(preview.view);
    expect(names(preview.view)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('settles before or after the row the item is released over inside its list', () => {
    const overC = 'channel:channel:C:channel/C#0';
    const above = settlePreview(preview, activeId, overC, { after: false });
    expect(names(above)).toEqual(['B', 'A', 'C', 'D']);
    expect(above.channels[1]?.groupId).toBe('g1');
    const below = settlePreview(preview, activeId, overC, { after: true });
    expect(names(below)).toEqual(['B', 'C', 'A', 'D']);
    expect(below.channels[2]?.groupId).toBe('g1');
  });

  it('joins another group container first or last', () => {
    // g3 is the empty group at the end of the view, so A becomes its first member after D.
    const settled = settlePreview(preview, activeId, 'groupzone:g3', { after: true });
    expect(names(settled)).toEqual(['B', 'C', 'D', 'A']);
    expect(settled.channels[3]?.groupId).toBe('g3');
    // D previewed at the top of the root list: D | A | g1(B, C). Its upper half of g1's block
    // (the header) makes it the first member, the lower half the last.
    const atTop = previewFor(view, { kind: 'channel', index: 3 }, { kind: 'root', position: 0 });
    expect(atTop).not.toBeNull();
    const dId = 'channel:channel:D:channel/D#0';
    const first = settlePreview(atTop as NonNullable<typeof atTop>, dId, 'groupzone:g1', {
      after: false,
    });
    expect(names(first)).toEqual(['A', 'D', 'B', 'C']);
    expect(first.channels[1]?.groupId).toBe('g1');
    const last = settlePreview(atTop as NonNullable<typeof atTop>, dId, 'groupzone:g1', {
      after: true,
    });
    expect(names(last)).toEqual(['A', 'B', 'C', 'D']);
    expect(last.channels[3]?.groupId).toBe('g1');
  });

  it('keeps the preview when the drop target cannot be resolved', () => {
    expect(settlePreview(preview, activeId, 'available:aux/1', hint)).toBe(preview.view);
    expect(settlePreview(preview, activeId, 'group:g1', hint)).toBe(preview.view);
  });
});

describe('dropHintFor', () => {
  const over = { top: 100, height: 40 };

  it('reads the pointer against the midline of the row', () => {
    expect(dropHintFor({ x: 0, y: 110 }, over, null, true)).toEqual({ after: false });
    expect(dropHintFor({ x: 0, y: 120 }, over, null, true)).toEqual({ after: false });
    expect(dropHintFor({ x: 0, y: 121 }, over, null, false)).toEqual({ after: true });
    // The pointer wins over any keyboard direction that was recorded earlier.
    expect(dropHintFor({ x: 0, y: 110 }, over, true, true)).toEqual({ after: false });
  });

  it('follows the arrow direction inside one list and lands before the row across lists', () => {
    expect(dropHintFor(null, over, true, true)).toEqual({ after: true });
    expect(dropHintFor(null, over, false, true)).toEqual({ after: false });
    expect(dropHintFor(null, over, true, false)).toEqual({ after: false });
    expect(dropHintFor(null, over, null, true)).toEqual({ after: false });
  });
});

describe('dropAnimationFor', () => {
  it('animates rows and groups but not AVAILABLE channels or removals', () => {
    expect(dropAnimationFor({ kind: 'channel', index: 0 }, false)).toEqual({
      ...defaultDropAnimation,
      duration: DROP_ANIMATION_MS,
    });
    expect(dropAnimationFor({ kind: 'group', groupId: 'g1' }, false)).toEqual({
      ...defaultDropAnimation,
      duration: DROP_ANIMATION_MS,
    });
    expect(dropAnimationFor({ kind: 'available', channelId: 'aux/1' }, false)).toBeNull();
    expect(dropAnimationFor({ kind: 'channel', index: 0 }, true)).toBeNull();
    expect(dropAnimationFor({ kind: 'group', groupId: 'g1' }, true)).toBeNull();
  });
});
