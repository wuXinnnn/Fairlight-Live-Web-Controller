import { SortableContext } from '@dnd-kit/sortable';
import type { ChannelState, View } from '@flwc/shared';
import { Fragment, useImperativeHandle, useMemo, type RefObject } from 'react';
import { resolveViewChannels, type ResolvedViewChannel } from '../mixer/view-resolver.js';
import { previewSortingStrategy } from './dnd-collision.js';
import { availableDndId, channelDndId, groupDndId } from './dnd-ids.js';
import { PlaceholderRow } from './PlaceholderRow.js';
import { RootSlot } from './RootSlot.js';
import { channelRowKeys } from './row-keys.js';
import { SortableChannelRow, type ChannelRowHandlers } from './SortableChannelRow.js';
import {
  EmptyGroupBlock,
  SortableGroupBlock,
  type GroupBlockHandlers,
} from './SortableGroupBlock.js';
import { useDragPreview } from './use-drag-preview.js';
import { useFlipList, type FlipListHandle } from './use-flip-list.js';
import { nonEmptyBlocks, rootSlotPositionsFor, viewBlocks, type ViewBlock } from './view-order.js';

interface ChannelOrderListProps extends ChannelRowHandlers, GroupBlockHandlers {
  view: View;
  /** Live channels the references resolve against. */
  channels: ChannelState[];
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
  /** The list element; the FLIP list measures inside it and the page scrolls it. */
  listRef: RefObject<HTMLOListElement | null>;
  /** Receives the FLIP handle so the page can re-baseline or skip a tween. */
  flipRef?: RefObject<FlipListHandle | null>;
}

/**
 * The CHANNEL ORDER list: top-level blocks (ungrouped rows and groups with members) form the root
 * sortable list, each group nests its own sortable list, and empty groups trail as drop targets.
 * While a drag is previewed the preview view is rendered instead of the draft, with the dragged
 * item shown as a placeholder where it would land; the DOM order is the preview, so dnd-kit's
 * sorting strategy displaces nothing and the FLIP list animates the moves. While a channel is
 * dragged, root slots mark the block boundaries next to groups that no row can stand for. They
 * are computed without the dragged channel and drawn right before the block they precede, so
 * a placeholder previewed at a slot keeps that slot just below itself and hovering on stays put.
 */

function slotLabel(blocks: ViewBlock[], position: number): string {
  const above = blocks[position - 1];
  const below = blocks[position];
  if (above === undefined) {
    return 'the start of the list';
  }
  if (below === undefined) {
    return 'the end of the list';
  }
  const name = (block: ViewBlock) => (block.kind === 'group' ? `group ${block.group.name}` : '');
  return `the gap between ${name(above)} and ${name(below)}`;
}
export function ChannelOrderList(props: ChannelOrderListProps) {
  const { channels, duplicateNames, channelInventoryLoaded, saving, listRef, flipRef } = props;
  const { dragging, sourceKind, source, preview } = useDragPreview();
  const view = preview?.view ?? props.view;
  // The tween runs on the view that is actually rendered, so a drag preview animates too.
  const flip = useFlipList(listRef, view);
  useImperativeHandle(flipRef, () => flip, [flip]);
  const placeholderIndex =
    preview?.placeholderChannelId === undefined || preview.source.kind !== 'channel'
      ? -1
      : preview.source.index;
  const resolved = useMemo(() => resolveViewChannels(view, channels), [view, channels]);
  const rowKeys = channelRowKeys(view);
  const rowDndId = (index: number): string =>
    index === placeholderIndex && preview?.placeholderChannelId !== undefined
      ? availableDndId(preview.placeholderChannelId)
      : channelDndId(rowKeys[index] ?? '');
  const rootItems = nonEmptyBlocks(view).map((block) =>
    block.kind === 'single' ? rowDndId(block.index) : groupDndId(block.group.id),
  );
  const renderRow = (entry: ResolvedViewChannel, rowKey: string) => {
    if (entry.index === placeholderIndex && preview?.placeholderChannelId !== undefined) {
      const reference = entry.reference;
      const groupId = view.groups.some((group) => group.id === reference.groupId)
        ? reference.groupId
        : undefined;
      return (
        <PlaceholderRow
          key={rowKey}
          channelId={preview.placeholderChannelId}
          name={reference.name}
          kind={entry.channel?.kind ?? reference.kind}
          index={entry.index}
          rowKey={rowKey}
          groupId={groupId}
        />
      );
    }
    return (
      <SortableChannelRow
        key={rowKey}
        entry={entry}
        view={view}
        rowKey={rowKey}
        duplicateNames={duplicateNames}
        channelInventoryLoaded={channelInventoryLoaded}
        saving={saving}
        onMoveChannel={props.onMoveChannel}
        onAssignGroup={props.onAssignGroup}
        onSetColor={props.onSetColor}
      />
    );
  };
  const blocks = viewBlocks(view);
  const groupNumbers = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === 'group') {
      groupNumbers.set(block.group.id, groupNumbers.size + 1);
    }
  }
  // The ordered blocks as they would be without the dragged channel: slot positions count
  // these, and each slot is drawn before the block it precedes (or after the last block).
  const draggedIndex = dragging && source?.kind === 'channel' ? source.index : -1;
  const isDragged = (block: ViewBlock) =>
    block.kind === 'single'
      ? block.index === draggedIndex
      : block.indices.length === 1 && block.indices[0] === draggedIndex;
  const ordered = blocks.filter((block) => block.kind === 'single' || block.indices.length > 0);
  const remaining = ordered.filter((block) => !isDragged(block));
  // The position the dragged row occupies among the remaining blocks, when it is a root row.
  const draggedOrdered = ordered.findIndex((block) => block.kind === 'single' && isDragged(block));
  const currentPosition =
    draggedOrdered < 0 ? -1 : ordered.slice(0, draggedOrdered).filter((b) => !isDragged(b)).length;
  const slotPositions = dragging && sourceKind !== 'group' ? rootSlotPositionsFor(remaining) : [];
  const slotBeforeBlock = new Map<ViewBlock, number>();
  let slotAfterLast: number | undefined;
  for (const position of slotPositions) {
    const block = remaining[position];
    if (block === undefined) {
      slotAfterLast = position;
    } else {
      slotBeforeBlock.set(block, position);
    }
  }
  const slotAt = (position: number | undefined) =>
    position === undefined ? null : (
      <RootSlot
        key={`slot:${position}`}
        position={position}
        label={slotLabel(remaining, position)}
        current={position === currentPosition}
      />
    );
  const lastOrdered = ordered[ordered.length - 1];
  // A view whose draft has no ordered block (no channels, or only empty groups) still needs a
  // place to drop the first channel. The slot is decided by the draft, not by the preview: were
  // it gated on the rendered view it would unmount the moment a placeholder appeared, leaving
  // the pointer over nothing, which clears the preview and brings the slot back, frame by frame.
  const emptyDraft = nonEmptyBlocks(props.view).length === 0;
  const fillSlot =
    dragging && sourceKind !== 'group' && emptyDraft ? (
      <RootSlot
        key="slot:fill"
        position={remaining.length}
        label="the start of the list"
        current={false}
        fill
      />
    ) : null;
  return (
    <SortableContext items={rootItems} strategy={previewSortingStrategy}>
      <ol className="view-channel-list" ref={listRef}>
        {view.channels.length === 0 && view.groups.length === 0 && (
          <li className="panel-empty">THIS VIEW HAS NO CHANNELS</li>
        )}
        {blocks.map((block) => {
          const slotBefore = slotAt(slotBeforeBlock.get(block));
          const slotAfter = block === lastOrdered ? slotAt(slotAfterLast) : null;
          if (block.kind === 'single') {
            const entry = resolved[block.index];
            return entry === undefined ? null : (
              <Fragment key={rowKeys[block.index] ?? ''}>
                {slotBefore}
                {renderRow(entry, rowKeys[block.index] ?? '')}
                {slotAfter}
              </Fragment>
            );
          }
          const entries = block.indices
            .map((index) => resolved[index])
            .filter((entry) => entry !== undefined);
          const shared = {
            group: block.group,
            entries,
            view,
            groupNumber: groupNumbers.get(block.group.id) ?? 0,
            saving,
            onMoveGroup: props.onMoveGroup,
            onRenameGroup: props.onRenameGroup,
            onRemoveGroup: props.onRemoveGroup,
          };
          return entries.length === 0 ? (
            <EmptyGroupBlock key={block.group.id} {...shared} />
          ) : (
            <Fragment key={block.group.id}>
              {slotBefore}
              <SortableGroupBlock
                {...shared}
                rowKeys={block.indices.map((index) => rowKeys[index] ?? '')}
                itemIds={block.indices.map(rowDndId)}
                renderRow={renderRow}
              />
              {slotAfter}
            </Fragment>
          );
        })}
        {fillSlot}
      </ol>
    </SortableContext>
  );
}
