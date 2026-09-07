import {
  closestCenter,
  pointerWithin,
  type ClientRect,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { readItemData, type DndItemData, type DndItemKind } from './dnd-ids.js';

/**
 * Which droppables a dragged item may land on. Channels (from the list or the AVAILABLE list)
 * land on channel rows or group containers; groups land on ungrouped rows or other groups, so a
 * group can never enter another group.
 */
export function isEligibleTarget(source: DndItemKind, candidate: DndItemData): boolean {
  switch (source) {
    case 'channel':
    case 'available':
      return candidate.kind === 'channel' || candidate.kind === 'groupzone';
    case 'group':
      return (
        (candidate.kind === 'channel' && candidate.groupId === undefined) ||
        candidate.kind === 'group'
      );
    default:
      return false;
  }
}

function eligibleContainers(
  source: DndItemKind,
  containers: DroppableContainer[],
  activeId?: UniqueIdentifier,
): DroppableContainer[] {
  return containers.filter((container) => {
    // The dragged item's own droppable stays eligible: the sortable strategy needs `over` to
    // fall back to the active item while it hovers over its own placeholder.
    if (container.id === activeId) {
      return true;
    }
    const data = readItemData(container);
    return data !== undefined && isEligibleTarget(source, data);
  });
}

/** Non-empty group containers share their rectangle with their members, so only rows count. */
function withoutPopulatedZones(containers: DroppableContainer[]): DroppableContainer[] {
  return containers.filter((container) => {
    const data = readItemData(container);
    return data?.kind !== 'groupzone' || data.empty;
  });
}

/**
 * Pointer and touch drags use what the pointer is inside (rows win over the group container
 * around them; the container alone means "append to this group"), so releasing outside the list
 * yields no target. Keyboard drags use the nearest centre among the eligible targets.
 */
export const viewCollisionDetection: CollisionDetection = (args) => {
  const source = readItemData(args.active)?.kind;
  if (source === undefined) {
    return [];
  }
  const eligible = eligibleContainers(source, args.droppableContainers, args.active.id);
  if (args.pointerCoordinates !== null) {
    const within = pointerWithin({ ...args, droppableContainers: eligible });
    const rows = within.filter(
      (collision) => readItemData(collision.data?.droppableContainer)?.kind !== 'groupzone',
    );
    return rows.length > 0 ? rows : within;
  }
  return closestCenter({ ...args, droppableContainers: withoutPopulatedZones(eligible) });
};

interface Candidate {
  rect: ClientRect;
  centre: number;
}

/**
 * Keyboard moves centre the dragged item on the next eligible target above or below it. The
 * stock sortable getter aligns edges, which leaves a tall group block ambiguous for
 * `closestCenter`. An AVAILABLE channel that is not over the list yet jumps to its first or last
 * target so the right column is reachable from the left.
 */
export const viewKeyboardCoordinates: KeyboardCoordinateGetter = (event, { active, context }) => {
  const { collisionRect, droppableRects, droppableContainers, over } = context;
  const source = readItemData(droppableContainers.get(active) ?? context.active)?.kind;
  const down = event.code === 'ArrowDown' || event.code === 'ArrowRight';
  const up = event.code === 'ArrowUp' || event.code === 'ArrowLeft';
  if (collisionRect === null || source === undefined || (!down && !up)) {
    return undefined;
  }
  event.preventDefault();
  const candidates: Candidate[] = withoutPopulatedZones(
    eligibleContainers(source, droppableContainers.getEnabled()),
  )
    .filter((container) => container.id !== active)
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect === undefined ? [] : [{ rect, centre: rect.top + rect.height / 2 }];
    })
    .sort((a, b) => a.centre - b.centre);
  const activeCentre = collisionRect.top + collisionRect.height / 2;
  let next: Candidate | undefined;
  if (source === 'available' && over === null) {
    next = down ? candidates[0] : candidates[candidates.length - 1];
  } else if (down) {
    next = candidates.find((candidate) => candidate.centre > activeCentre + 0.5);
  } else {
    next = [...candidates].reverse().find((candidate) => candidate.centre < activeCentre - 0.5);
  }
  if (next === undefined) {
    return undefined;
  }
  return {
    x: next.rect.left + next.rect.width / 2 - collisionRect.width / 2,
    y: next.centre - collisionRect.height / 2,
  };
};
