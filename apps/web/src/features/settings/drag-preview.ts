import { getEventCoordinates } from '@dnd-kit/utilities';
import type { ChannelState, View } from '@flwc/shared';
import { referenceForChannel } from '../mixer/view-resolver.js';
import type { DragSource } from './drop-resolver.js';
import {
  insertChannelAt,
  moveChannelTo,
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
      const reference = view.channels[source.index];
      if (reference === undefined) {
        return null;
      }
      const groupId = reference.groupId;
      return groupId !== undefined && view.groups.some((group) => group.id === groupId)
        ? { kind: 'group', groupId }
        : { kind: 'root' };
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

function movedIndex(before: View, after: View): number {
  return after.channels.findIndex((reference) => !before.channels.includes(reference));
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
      const next = moveChannelTo(view, source.index, target);
      if (next === null) {
        return null;
      }
      return { view: next, source: { kind: 'channel', index: movedIndex(view, next) } };
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
      const next = insertChannelAt(view, referenceForChannel(channel), target);
      if (next === null) {
        return null;
      }
      return {
        view: next,
        source: { kind: 'channel', index: movedIndex(view, next) },
        placeholderChannelId: channel.id,
      };
    }
  }
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
