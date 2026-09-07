import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ChannelState, View } from '@flwc/shared';
import { useMemo, type Ref } from 'react';
import { resolveViewChannels, type ResolvedViewChannel } from '../mixer/view-resolver.js';
import { availableDndId, channelDndId, groupDndId } from './dnd-ids.js';
import { PlaceholderRow } from './PlaceholderRow.js';
import { channelRowKeys } from './row-keys.js';
import { SortableChannelRow, type ChannelRowHandlers } from './SortableChannelRow.js';
import {
  EmptyGroupBlock,
  SortableGroupBlock,
  type GroupBlockHandlers,
} from './SortableGroupBlock.js';
import { useDragPreview } from './use-drag-preview.js';
import { nonEmptyBlocks, viewBlocks } from './view-order.js';

interface ChannelOrderListProps extends ChannelRowHandlers, GroupBlockHandlers {
  view: View;
  /** Live channels the references resolve against. */
  channels: ChannelState[];
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
  listRef?: Ref<HTMLOListElement>;
}

/**
 * The CHANNEL ORDER list: top-level blocks (ungrouped rows and groups with members) form the root
 * sortable list, each group nests its own sortable list, and empty groups trail as drop targets.
 * While a drag previews a move into another list the preview view is rendered instead of the
 * draft, with the dragged item shown as a placeholder where it would land.
 */
export function ChannelOrderList(props: ChannelOrderListProps) {
  const { channels, duplicateNames, channelInventoryLoaded, saving, listRef } = props;
  const { preview } = useDragPreview();
  const view = preview?.view ?? props.view;
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
  return (
    <SortableContext items={rootItems} strategy={verticalListSortingStrategy}>
      <ol className="view-channel-list" ref={listRef}>
        {blocks.map((block) => {
          if (block.kind === 'single') {
            const entry = resolved[block.index];
            return entry === undefined ? null : renderRow(entry, rowKeys[block.index] ?? '');
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
            <SortableGroupBlock
              key={block.group.id}
              {...shared}
              rowKeys={block.indices.map((index) => rowKeys[index] ?? '')}
              itemIds={block.indices.map(rowDndId)}
              renderRow={renderRow}
            />
          );
        })}
      </ol>
    </SortableContext>
  );
}
