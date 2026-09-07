import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { View } from '@flwc/shared';
import type { Ref } from 'react';
import type { ResolvedViewChannel } from '../mixer/view-resolver.js';
import { channelDndId, groupDndId } from './dnd-ids.js';
import { channelRowKeys } from './row-keys.js';
import { SortableChannelRow, type ChannelRowHandlers } from './SortableChannelRow.js';
import {
  EmptyGroupBlock,
  SortableGroupBlock,
  type GroupBlockHandlers,
} from './SortableGroupBlock.js';
import { nonEmptyBlocks, viewBlocks } from './view-order.js';

interface ChannelOrderListProps extends ChannelRowHandlers, GroupBlockHandlers {
  view: View;
  resolved: ResolvedViewChannel[];
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
  listRef?: Ref<HTMLOListElement>;
}

/**
 * The CHANNEL ORDER list: top-level blocks (ungrouped rows and groups with members) form the root
 * sortable list, each group nests its own sortable list, and empty groups trail as drop targets.
 */
export function ChannelOrderList(props: ChannelOrderListProps) {
  const { view, resolved, duplicateNames, channelInventoryLoaded, saving, listRef } = props;
  const rowKeys = channelRowKeys(view);
  const rootItems = nonEmptyBlocks(view).map((block) =>
    block.kind === 'single' ? channelDndId(rowKeys[block.index] ?? '') : groupDndId(block.group.id),
  );
  const renderRow = (entry: ResolvedViewChannel, rowKey: string) => (
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
              renderRow={renderRow}
            />
          );
        })}
      </ol>
    </SortableContext>
  );
}
