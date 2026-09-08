import type { UniqueIdentifier } from '@dnd-kit/core';
import type { View, ViewChannelRef } from '@flwc/shared';
import { parseDndId } from './dnd-ids.js';
import { channelRowKeys } from './row-keys.js';
import { memberIndices, nonEmptyBlocks, type DropTarget, type ViewBlock } from './view-order.js';

/** What is being dragged, resolved against the view the drag started from. */
export type DragSource =
  | { kind: 'channel'; index: number }
  | { kind: 'group'; groupId: string }
  | { kind: 'available'; channelId: string };

export interface DropHint {
  /** True when the pointer is below the midline of the row or group block it is over. */
  after: boolean;
}

function knownGroupId(view: View, reference: ViewChannelRef | undefined): string | undefined {
  const groupId = reference?.groupId;
  return groupId !== undefined && view.groups.some((group) => group.id === groupId)
    ? groupId
    : undefined;
}

/** Top-level blocks of `view`, without the dragged group's own block when a group is dragged. */
function restBlocks(view: View, draggedGroupId: string | undefined): ViewBlock[] {
  return nonEmptyBlocks(view).filter(
    (block) => block.kind !== 'group' || block.group.id !== draggedGroupId,
  );
}

function singlePosition(view: View, draggedGroupId: string | undefined, index: number): number {
  return restBlocks(view, draggedGroupId).findIndex(
    (block) => block.kind === 'single' && block.index === index,
  );
}

function groupPosition(view: View, draggedGroupId: string | undefined, groupId: string): number {
  return restBlocks(view, draggedGroupId).findIndex(
    (block) => block.kind === 'group' && block.group.id === groupId,
  );
}

/** Maps the active identifier back to the view; stale identifiers yield null. */
export function dragSourceFor(view: View, activeId: UniqueIdentifier): DragSource | null {
  const parsed = parseDndId(activeId);
  switch (parsed?.kind) {
    case 'channel': {
      const index = channelRowKeys(view).indexOf(parsed.rowKey);
      return index < 0 ? null : { kind: 'channel', index };
    }
    case 'group':
      return { kind: 'group', groupId: parsed.groupId };
    case 'available':
      return { kind: 'available', channelId: parsed.channelId };
    default:
      return null;
  }
}

/**
 * Turns the droppable the drag is over into a `DropTarget`. The rule is the same inside one list
 * and across lists: the dragged item lands before the row (or group block) it is over, or after
 * it when `hint.after` is set. A group container puts the channel first when hit in its upper
 * half (the header) and last when hit in its lower half (the bottom edge), and root slots place
 * the channel as an ungrouped row at the block boundary they mark. Positions count the view
 * without the dragged item, as `moveChannelTo` and `moveGroupTo` expect.
 */
export function resolveDropTarget(
  view: View,
  source: DragSource,
  overId: UniqueIdentifier,
  hint: DropHint,
): DropTarget | null {
  const over = parseDndId(overId);
  if (over === null || over.kind === 'available') {
    return null;
  }
  const removed = source.kind === 'channel' ? source.index : null;
  const base =
    removed === null
      ? view
      : { ...view, channels: view.channels.filter((_, index) => index !== removed) };
  const inBase = (index: number): number =>
    removed !== null && index > removed ? index - 1 : index;

  if (over.kind === 'slot') {
    // Slots already count the blocks of the view without the dragged channel.
    if (source.kind === 'group' || over.position > nonEmptyBlocks(base).length) {
      return null;
    }
    return { kind: 'root', position: over.position };
  }

  if (over.kind === 'groupzone') {
    if (source.kind === 'group' || !view.groups.some((group) => group.id === over.groupId)) {
      return null;
    }
    return {
      kind: 'group',
      groupId: over.groupId,
      position: hint.after ? memberIndices(base, over.groupId).length : 0,
    };
  }

  const offset = hint.after ? 1 : 0;

  if (over.kind === 'group') {
    if (source.kind !== 'group' || source.groupId === over.groupId) {
      return null;
    }
    const position = groupPosition(base, source.groupId, over.groupId);
    return position < 0 ? null : { kind: 'root', position: position + offset };
  }

  const overIndex = channelRowKeys(view).indexOf(over.rowKey);
  if (overIndex < 0 || overIndex === removed) {
    return null;
  }
  const overGroup = knownGroupId(view, view.channels[overIndex]);

  if (source.kind === 'group') {
    if (overGroup !== undefined) {
      return null;
    }
    return { kind: 'root', position: singlePosition(base, source.groupId, overIndex) + offset };
  }

  const baseIndex = inBase(overIndex);
  return overGroup === undefined
    ? { kind: 'root', position: singlePosition(base, undefined, baseIndex) + offset }
    : {
        kind: 'group',
        groupId: overGroup,
        position: memberIndices(base, overGroup).indexOf(baseIndex) + offset,
      };
}
