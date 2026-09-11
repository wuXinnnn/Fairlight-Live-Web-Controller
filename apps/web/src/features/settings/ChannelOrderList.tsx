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
import { groupOfIndex, rootSlotPositionsFor, viewBlocks, type ViewBlock } from './view-order.js';

interface ChannelOrderListProps extends ChannelRowHandlers, GroupBlockHandlers {
  view: View;
  /** Live channels the references resolve against. */
  channels: ChannelState[];
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
  /** Ids of the groups whose members are hidden; editor state, not part of the view. */
  collapsedGroupIds: ReadonlySet<string>;
  /** The list element; the FLIP list measures inside it and the page scrolls it. */
  listRef: RefObject<HTMLOListElement | null>;
  /** Receives the FLIP handle so the page can re-baseline or skip a tween. */
  flipRef?: RefObject<FlipListHandle | null>;
}

/**
 * The CHANNEL ORDER list: every item is a top-level block of the root sortable list - an
 * ungrouped row, or a group with its own nested sortable list. A group without members is a
 * block like any other, in its own place, and is both draggable and a drop target.
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
  const {
    channels,
    duplicateNames,
    channelInventoryLoaded,
    saving,
    collapsedGroupIds,
    listRef,
    flipRef,
  } = props;
  const { dragging, sourceKind, source, preview } = useDragPreview();
  const view = preview?.view ?? props.view;
  // The tween runs on the view that is actually rendered, so a drag preview animates too, and
  // collapsing a group shifts every row below it.
  const flipDependency = useMemo(() => ({ view, collapsedGroupIds }), [view, collapsedGroupIds]);
  const flip = useFlipList(listRef, flipDependency);
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
  const blocks = viewBlocks(view);
  const rootItems = blocks.map((block) =>
    block.kind === 'single' ? rowDndId(block.index) : groupDndId(block.group.id),
  );
  const renderRow = (entry: ResolvedViewChannel, rowKey: string) => {
    if (entry.index === placeholderIndex && preview?.placeholderChannelId !== undefined) {
      const reference = entry.reference;
      const groupId = groupOfIndex(view, entry.index)?.id;
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
    const group = groupOfIndex(view, entry.index);
    return (
      <SortableChannelRow
        key={rowKey}
        entry={entry}
        view={view}
        rowKey={rowKey}
        group={group}
        duplicateNames={duplicateNames}
        channelInventoryLoaded={channelInventoryLoaded}
        saving={saving}
        dragging={dragging}
        onMoveChannel={props.onMoveChannel}
        onAssignGroup={props.onAssignGroup}
        onSetColor={props.onSetColor}
        onDeleteChannel={props.onDeleteChannel}
      />
    );
  };
  const groupNumbers = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === 'group') {
      groupNumbers.set(block.group.id, groupNumbers.size + 1);
    }
  }
  // The blocks as they would be without the dragged one: slot positions count these, and each
  // slot is drawn before the block it precedes. A group that the dragged row is the last member
  // of stays in the count, because it stays in the list as an empty block.
  const draggedBlock =
    !dragging || source === null
      ? -1
      : source.kind === 'group'
        ? blocks.findIndex((block) => block.kind === 'group' && block.group.id === source.groupId)
        : source.kind === 'channel'
          ? blocks.findIndex((block) => block.kind === 'single' && block.index === source.index)
          : -1;
  const remaining = blocks.filter((_, position) => position !== draggedBlock);
  // Taking a block out and putting it back where it was is a no-op, so that is its position.
  const currentPosition = draggedBlock;
  const slotPositions = dragging && sourceKind !== 'group' ? rootSlotPositionsFor(remaining) : [];
  const slotBeforeBlock = new Map<ViewBlock, number>();
  for (const position of slotPositions) {
    const block = remaining[position];
    if (block !== undefined) {
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
  // The space under the last block is a drop target for the whole of a drag: it takes whatever
  // height the list has left, so dropping anywhere in the empty area below the rows appends to
  // the end. It is there for every kind of drag and for the whole of one, which is also what
  // stops it flickering - a slot that came and went as the preview changed would unmount under
  // the pointer, clear the preview, and come straight back, frame after frame.
  const fillSlot = dragging ? (
    <RootSlot
      key="slot:fill"
      position={remaining.length}
      label="the end of the list"
      current={remaining.length === currentPosition}
      fill
    />
  ) : null;
  return (
    <SortableContext items={rootItems} strategy={previewSortingStrategy}>
      <ol className="view-channel-list" ref={listRef}>
        {view.items.length === 0 && <li className="panel-empty">THIS VIEW HAS NO CHANNELS</li>}
        {blocks.map((block) => {
          const slotBefore = slotAt(slotBeforeBlock.get(block));
          if (block.kind === 'single') {
            const entry = resolved[block.index];
            return entry === undefined ? null : (
              <Fragment key={rowKeys[block.index] ?? ''}>
                {slotBefore}
                {renderRow(entry, rowKeys[block.index] ?? '')}
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
            collapsed: collapsedGroupIds.has(block.group.id),
            onMoveGroup: props.onMoveGroup,
            onRenameGroup: props.onRenameGroup,
            onRemoveGroup: props.onRemoveGroup,
            onDeleteGroup: props.onDeleteGroup,
            onToggleCollapse: props.onToggleCollapse,
            onSetGroupColor: props.onSetGroupColor,
          };
          return (
            <Fragment key={block.group.id}>
              {slotBefore}
              {entries.length === 0 ? (
                <EmptyGroupBlock {...shared} collapsed={false} />
              ) : (
                <SortableGroupBlock
                  {...shared}
                  rowKeys={block.indices.map((index) => rowKeys[index] ?? '')}
                  itemIds={block.indices.map(rowDndId)}
                  renderRow={renderRow}
                />
              )}
            </Fragment>
          );
        })}
        {fillSlot}
      </ol>
    </SortableContext>
  );
}
