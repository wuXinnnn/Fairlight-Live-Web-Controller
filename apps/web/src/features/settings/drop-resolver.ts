import type { UniqueIdentifier } from '@dnd-kit/core';
import type { View, ViewChannelRef } from '@flwc/shared';
import { parseDndId } from './dnd-ids.js';
import { channelRowKeys } from './row-keys.js';
import { memberIndices, nonEmptyBlocks, type DropTarget } from './view-order.js';

/** What is being dragged, resolved against the view the drag started from. */
export type DragSource =
  | { kind: 'channel'; index: number }
  | { kind: 'group'; groupId: string }
  | { kind: 'available'; channelId: string };

export interface DropHint {
  /** True when the dragged item was released below the midpoint of the row it is over. */
  after: boolean;
}

function knownGroupId(view: View, reference: ViewChannelRef | undefined): string | undefined {
  const groupId = reference?.groupId;
  return groupId !== undefined && view.groups.some((group) => group.id === groupId)
    ? groupId
    : undefined;
}

function singlePosition(view: View, index: number): number {
  return nonEmptyBlocks(view).findIndex(
    (block) => block.kind === 'single' && block.index === index,
  );
}

function groupPosition(view: View, groupId: string): number {
  return nonEmptyBlocks(view).findIndex(
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
 * Turns the droppable the drag ended over into a `DropTarget`. Inside one list the dragged item
 * takes the slot of the row it is over (the preview dnd-kit shows while sorting); across lists
 * it lands before that row, or after it when `hint.after` is set. Group containers append, and
 * root slots place the channel as an ungrouped row at the block boundary they mark.
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
      position: memberIndices(base, over.groupId).length,
    };
  }

  if (over.kind === 'group') {
    if (source.kind !== 'group' || source.groupId === over.groupId) {
      return null;
    }
    const position = groupPosition(view, over.groupId);
    return position < 0 ? null : { kind: 'root', position };
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
    return { kind: 'root', position: singlePosition(view, overIndex) };
  }

  const sourceGroup =
    source.kind === 'channel' ? knownGroupId(view, view.channels[source.index]) : undefined;
  if (source.kind === 'channel' && sourceGroup === overGroup) {
    return overGroup === undefined
      ? { kind: 'root', position: singlePosition(view, overIndex) }
      : {
          kind: 'group',
          groupId: overGroup,
          position: memberIndices(view, overGroup).indexOf(overIndex),
        };
  }

  const offset = hint.after ? 1 : 0;
  const baseIndex = inBase(overIndex);
  return overGroup === undefined
    ? { kind: 'root', position: singlePosition(base, baseIndex) + offset }
    : {
        kind: 'group',
        groupId: overGroup,
        position: memberIndices(base, overGroup).indexOf(baseIndex) + offset,
      };
}
