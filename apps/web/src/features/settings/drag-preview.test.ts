import type { ChannelState, View } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { defaultDropAnimation } from '@dnd-kit/core';
import {
  containerOf,
  containerOfTarget,
  dropAnimationFor,
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

  it('settles against the row the item is released over inside its list', () => {
    const settled = settlePreview(preview, activeId, 'channel:channel:C:channel/C#0', hint);
    expect(names(settled)).toEqual(['B', 'C', 'A', 'D']);
    expect(settled.channels[2]?.groupId).toBe('g1');
  });

  it('appends when released over another group container', () => {
    // g3 is the empty group at the end of the view, so A becomes its first member after D.
    const settled = settlePreview(preview, activeId, 'groupzone:g3', hint);
    expect(names(settled)).toEqual(['B', 'C', 'D', 'A']);
    expect(settled.channels[3]?.groupId).toBe('g3');
  });

  it('keeps the preview when the drop target cannot be resolved', () => {
    expect(settlePreview(preview, activeId, 'available:aux/1', hint)).toBe(preview.view);
    expect(settlePreview(preview, activeId, 'group:g1', hint)).toBe(preview.view);
  });
});

describe('dropAnimationFor', () => {
  it('animates rows and groups but not AVAILABLE channels or removals', () => {
    expect(dropAnimationFor({ kind: 'channel', index: 0 }, false)).toBe(defaultDropAnimation);
    expect(dropAnimationFor({ kind: 'group', groupId: 'g1' }, false)).toBe(defaultDropAnimation);
    expect(dropAnimationFor({ kind: 'available', channelId: 'aux/1' }, false)).toBeNull();
    expect(dropAnimationFor({ kind: 'channel', index: 0 }, true)).toBeNull();
    expect(dropAnimationFor({ kind: 'group', groupId: 'g1' }, true)).toBeNull();
  });
});
