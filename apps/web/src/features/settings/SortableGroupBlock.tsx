import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { View, ViewGroup } from '@flwc/shared';
import type { CSSProperties, ReactNode } from 'react';
import { channelColor, channelTypeColor } from '../mixer/channel-colors.js';
import type { ResolvedViewChannel } from '../mixer/view-resolver.js';
import { pad } from './channel-labels.js';
import { previewSortingStrategy } from './dnd-collision.js';
import { groupDndId, groupZoneDndId, readItemData } from './dnd-ids.js';
import { DragHandle } from './DragHandle.js';
import { OrderButtons } from './OrderButtons.js';
import { groupRowKey } from './row-keys.js';
import { moveGroup, type MoveDirection } from './view-order.js';

export interface GroupBlockHandlers {
  onMoveGroup(groupId: string, direction: MoveDirection): void;
  onRenameGroup(groupId: string, name: string): void;
  onRemoveGroup(groupId: string): void;
}

interface GroupBlockProps extends GroupBlockHandlers {
  group: ViewGroup;
  entries: ResolvedViewChannel[];
  /** Row keys of the entries, in the same order. */
  rowKeys: string[];
  /** Sortable ids of the entries, in the same order (a placeholder uses the drag's own id). */
  itemIds: string[];
  view: View;
  groupNumber: number;
  saving: boolean;
  renderRow(entry: ResolvedViewChannel, rowKey: string): ReactNode;
}

/** True while a channel (not a group) is dragged over this group or one of its members. */
function useIsDropTarget(groupId: string): boolean {
  const { active, over } = useDndContext();
  const source = readItemData(active)?.kind;
  const target = readItemData(over);
  return (
    (source === 'channel' || source === 'available') &&
    target !== undefined &&
    'groupId' in target &&
    target.groupId === groupId
  );
}

function groupAccent(entries: ResolvedViewChannel[]): string {
  const lead = entries.find((entry) => entry.channel !== undefined) ?? entries[0];
  return lead === undefined
    ? channelTypeColor('channel')
    : channelColor(lead.channel?.kind ?? lead.reference.kind, lead.reference.color);
}

function GroupHeader({
  group,
  entries,
  view,
  groupNumber,
  saving,
  handle,
  onMoveGroup,
  onRenameGroup,
  onRemoveGroup,
}: Omit<GroupBlockProps, 'renderRow' | 'rowKeys' | 'itemIds'> & { handle: ReactNode }) {
  const presentCount = entries.filter((entry) => entry.channel !== undefined).length;
  return (
    <div className="view-group__header">
      {handle}
      <div className="channel-order__index">G{pad(groupNumber)}</div>
      <span className="channel-order__accent" aria-hidden="true" />
      <input
        aria-label={`Group ${groupNumber} name`}
        value={group.name}
        onChange={(event) => onRenameGroup(group.id, event.target.value)}
        disabled={saving}
      />
      <small>{pad(presentCount)} CH</small>
      <OrderButtons
        label={`group ${group.name}`}
        canMoveUp={moveGroup(view, group.id, -1) !== null}
        canMoveDown={moveGroup(view, group.id, 1) !== null}
        onMove={(direction) => onMoveGroup(group.id, direction)}
      />
      <button
        type="button"
        className="utility-button"
        aria-label={`Ungroup ${group.name}`}
        onClick={() => onRemoveGroup(group.id)}
        disabled={saving}
      >
        UNGROUP
      </button>
    </div>
  );
}

/** A group with members: a sortable block in the root list and a drop container for channels. */
export function SortableGroupBlock(props: GroupBlockProps) {
  const { group, entries, rowKeys, itemIds, saving, renderRow } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: groupDndId(group.id),
    data: { kind: 'group', label: `group ${group.name}`, groupId: group.id },
    disabled: saving,
    animateLayoutChanges: () => false,
    transition: null,
  });
  const { setNodeRef: setZoneRef } = useDroppable({
    id: groupZoneDndId(group.id),
    data: { kind: 'groupzone', label: `group ${group.name}`, groupId: group.id, empty: false },
    disabled: saving,
  });
  const isDropTarget = useIsDropTarget(group.id);
  const style = {
    '--channel-row-accent': groupAccent(entries),
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setZoneRef(node);
      }}
      className={`view-group ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
      data-flip-key={groupRowKey(group.id)}
      data-view-group-id={group.id}
      style={style}
    >
      <GroupHeader
        {...props}
        handle={
          <DragHandle
            label={`Drag group ${group.name}`}
            handleRef={setActivatorNodeRef}
            attributes={attributes}
            listeners={listeners}
            disabled={saving}
          />
        }
      />
      <SortableContext items={itemIds} strategy={previewSortingStrategy}>
        <ol className="view-group__members">
          {entries.map((entry, position) => renderRow(entry, rowKeys[position] ?? ''))}
        </ol>
      </SortableContext>
    </li>
  );
}

/** A group without members: only a drop container, always listed after the ordered blocks. */
export function EmptyGroupBlock(props: Omit<GroupBlockProps, 'renderRow' | 'rowKeys' | 'itemIds'>) {
  const { group, saving } = props;
  const { setNodeRef } = useDroppable({
    id: groupZoneDndId(group.id),
    data: { kind: 'groupzone', label: `group ${group.name}`, groupId: group.id, empty: true },
    disabled: saving,
  });
  const isDropTarget = useIsDropTarget(group.id);
  return (
    <li
      ref={setNodeRef}
      className={`view-group ${isDropTarget ? 'is-drop-target' : ''}`}
      data-flip-key={groupRowKey(group.id)}
      data-view-group-id={group.id}
      style={{ '--channel-row-accent': channelTypeColor('channel') } as CSSProperties}
    >
      <GroupHeader
        {...props}
        handle={<span className="drag-handle is-placeholder" aria-hidden="true" />}
      />
      <p className="view-group__empty">ASSIGN CHANNELS BELOW</p>
    </li>
  );
}
