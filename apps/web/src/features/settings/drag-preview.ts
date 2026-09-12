import { defaultDropAnimation, type DropAnimation, type UniqueIdentifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import type { ChannelState, View } from '@flwc/shared';
import { referenceForChannel } from '../mixer/view-resolver.js';
import { DROP_ANIMATION_MS } from './dnd-config.js';
import { parseDndId } from './dnd-ids.js';
import { resolveDropTarget, type DragSource, type DropHint } from './drop-resolver.js';
import {
  groupOfIndex,
  insertChannelAtAt,
  locateChannel,
  moveChannelToAt,
  moveGroupTo,
  removeChannel,
  removeGroupWithMembers,
  type DropTarget,
} from './view-order.js';

/** One of the sortable lists on the page: the root list or a group's member list. */
export type ListContainer = { kind: 'root' } | { kind: 'group'; groupId: string };

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * The view as it would look if the drag ended now: the dragged item already sits in its target
 * container, so the list can render it there as a placeholder. `source` locates the dragged
 * item inside `view`; `placeholderChannelId` is set while an AVAILABLE channel is previewed.
 */
export interface DragPreview {
  view: View;
  source: DragSource;
  placeholderChannelId?: string;
}

export function sameContainer(a: ListContainer | null, b: ListContainer | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.kind === 'group' && b.kind === 'group' ? a.groupId === b.groupId : a.kind === b.kind;
}

/** The list a dragged item currently belongs to; AVAILABLE channels belong to none. */
export function containerOf(view: View, source: DragSource): ListContainer | null {
  switch (source.kind) {
    case 'channel': {
      if (locateChannel(view, source.index) === null) {
        return null;
      }
      const group = groupOfIndex(view, source.index);
      return group === undefined ? { kind: 'root' } : { kind: 'group', groupId: group.id };
    }
    case 'group':
      return { kind: 'root' };
    default:
      return null;
  }
}

export function containerOfTarget(target: DropTarget): ListContainer {
  return target.kind === 'group' ? { kind: 'group', groupId: target.groupId } : { kind: 'root' };
}

/**
 * Applies `target` to a copy of the view so the dragged item can be shown at its destination.
 * Returns null when the move changes nothing or is not possible.
 */
export function previewFor(
  view: View,
  source: DragSource,
  target: DropTarget,
  channel?: ChannelState,
): DragPreview | null {
  switch (source.kind) {
    case 'channel': {
      const placed = moveChannelToAt(view, source.index, target);
      if (placed === null) {
        return null;
      }
      return { view: placed.view, source: { kind: 'channel', index: placed.index } };
    }
    case 'group': {
      if (target.kind !== 'root') {
        return null;
      }
      const next = moveGroupTo(view, source.groupId, target.position);
      return next === null ? null : { view: next, source };
    }
    case 'available': {
      if (channel === undefined) {
        return null;
      }
      const placed = insertChannelAtAt(view, referenceForChannel(channel), target);
      if (placed === null) {
        return null;
      }
      return {
        view: placed.view,
        source: { kind: 'channel', index: placed.index },
        placeholderChannelId: channel.id,
      };
    }
  }
}

/**
 * The view to commit when a drag that produced a preview ends over `overId`. The placeholder
 * already shows where the item lands, so releasing it over itself or over the container it sits
 * in keeps the preview as it is; releasing it over a row settles the move against that row, the
 * same way a drag inside one list does.
 */
export function settlePreview(
  preview: DragPreview,
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
  hint: DropHint,
): View {
  const { view, source } = preview;
  if (overId === activeId) {
    return view;
  }
  const over = parseDndId(overId);
  if (over?.kind === 'groupzone') {
    const container = containerOf(view, source);
    if (container?.kind === 'group' && container.groupId === over.groupId) {
      return view;
    }
  }
  const target = resolveDropTarget(view, source, overId, hint);
  if (target === null) {
    return view;
  }
  const settled =
    source.kind === 'channel'
      ? (moveChannelToAt(view, source.index, target)?.view ?? null)
      : source.kind === 'group' && target.kind === 'root'
        ? moveGroupTo(view, source.groupId, target.position)
        : null;
  return settled ?? view;
}

/** The geometry a drop hint is read against: the droppable rectangle the drag is over. */
export interface OverRect {
  top: number;
  height: number;
}

/**
 * Whether the dragged item goes after the row (or block) it is over. Pointer and touch drags
 * read the pointer against the row's midline, so the same position means the same target in
 * every list and from either direction. Keyboard drags have no pointer: inside one list an arrow
 * down lands after the next row and an arrow up before it, and a row entering another list lands
 * before the row it reaches.
 */
export function dropHintFor(
  pointer: Point | null,
  over: OverRect,
  keyboardDown: boolean | null,
  sameList: boolean,
): DropHint {
  if (pointer !== null) {
    return { after: pointer.y > over.top + over.height / 2 };
  }
  return { after: sameList && keyboardDown === true };
}

/**
 * How the drag overlay leaves the screen: rows and groups fly to the row they became, an
 * AVAILABLE channel turns into its placeholder in place, and a removed item just disappears.
 */
export function dropAnimationFor(source: DragSource, removing: boolean): DropAnimation | null {
  return removing || source.kind === 'available'
    ? null
    : { ...defaultDropAnimation, duration: DROP_ANIMATION_MS };
}

/** The view without the dragged item; null for AVAILABLE channels, which are not in it yet. */
export function removalFor(view: View, source: DragSource): View | null {
  switch (source.kind) {
    case 'channel':
      return removeChannel(view, source.index);
    case 'group':
      return removeGroupWithMembers(view, source.groupId);
    default:
      return null;
  }
}

/** Viewport position of a pointer or touch event; null for keyboard and other events. */
export function eventPoint(event: Event | null): Point | null {
  if (event === null) {
    return null;
  }
  const point = getEventCoordinates(event);
  return point === null ? null : { x: point.x, y: point.y };
}

/** True when the point lies more than `threshold` pixels outside the box on any side. */
export function pointerOutside(point: Point, box: Box, threshold: number): boolean {
  return (
    point.x < box.left - threshold ||
    point.x > box.right + threshold ||
    point.y < box.top - threshold ||
    point.y > box.bottom + threshold
  );
}
