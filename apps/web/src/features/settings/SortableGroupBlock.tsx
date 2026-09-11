import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CHANNEL_PALETTE_KEYS,
  type ChannelPaletteKey,
  type View,
  type ViewGroup,
} from '@flwc/shared';
import type { CSSProperties, ReactNode } from 'react';
import { CHANNEL_PALETTE, groupAccent } from '../mixer/channel-colors.js';
import { leadChannelKind, type ResolvedViewChannel } from '../mixer/view-resolver.js';
import { PALETTE_LABELS, pad } from './channel-labels.js';
import { previewSortingStrategy } from './dnd-collision.js';
import { groupDndId, groupZoneDndId, readItemData } from './dnd-ids.js';
import { DeleteButton } from './DeleteButton.js';
import { DragHandle } from './DragHandle.js';
import { OrderButtons } from './OrderButtons.js';
import { PaletteControl, type PaletteChoice } from './PaletteControl.js';
import { RowMenu, type RowMenuSection } from './RowMenu.js';
import { groupRowKey } from './row-keys.js';
import { useDragPreview } from './use-drag-preview.js';
import { moveGroup, type MoveDirection } from './view-order.js';

export interface GroupBlockHandlers {
  onMoveGroup(groupId: string, direction: MoveDirection): void;
  onRenameGroup(groupId: string, name: string): void;
  /** Dissolves the group and leaves its members behind as ungrouped rows. */
  onRemoveGroup(groupId: string): void;
  /** Deletes the group together with every channel in it. */
  onDeleteGroup(groupId: string): void;
  onToggleCollapse(groupId: string): void;
  onSetGroupColor(groupId: string, color?: ChannelPaletteKey): void;
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
  /** Editor state, not part of the view: a collapsed group hides its members. */
  collapsed: boolean;
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

/** Chevron for the collapse button: pointing down while open, right while collapsed. */
function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d={collapsed ? 'M4.5 2.5 8 6l-3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
    </svg>
  );
}

function GroupHeader({
  group,
  entries,
  view,
  groupNumber,
  saving,
  collapsed,
  handle,
  membersId,
  onMoveGroup,
  onRenameGroup,
  onRemoveGroup,
  onDeleteGroup,
  onToggleCollapse,
  onSetGroupColor,
}: Omit<GroupBlockProps, 'renderRow' | 'rowKeys' | 'itemIds'> & {
  handle: ReactNode;
  /** Id of the member list the collapse button controls; undefined for an empty group. */
  membersId?: string;
}) {
  const presentCount = entries.filter((entry) => entry.channel !== undefined).length;
  const { dragging } = useDragPreview();
  const colorChoices: PaletteChoice<ChannelPaletteKey | undefined>[] = [
    {
      id: 'auto',
      value: undefined,
      ariaLabel: `Group ${group.name} use automatic color`,
      title: "First member's type",
      text: 'AUTO',
      selected: group.color === undefined,
    },
    ...CHANNEL_PALETTE_KEYS.map((color) => ({
      id: color,
      value: color,
      ariaLabel: `Group ${group.name} color ${PALETTE_LABELS[color]}`,
      title: PALETTE_LABELS[color],
      swatch: CHANNEL_PALETTE[color],
      selected: group.color === color,
    })),
  ];
  const canMoveUp = moveGroup(view, group.id, -1) !== null;
  const canMoveDown = moveGroup(view, group.id, 1) !== null;
  const menuSections: RowMenuSection[] = [
    {
      label: 'ORDER',
      items: [
        { id: 'move:up', text: 'MOVE UP', disabled: !canMoveUp },
        { id: 'move:down', text: 'MOVE DOWN', disabled: !canMoveDown },
      ],
    },
    {
      label: 'GROUP COLOR',
      items: colorChoices.map((choice) => ({
        id: `color:${choice.id}`,
        text: choice.text ?? choice.title,
        selected: choice.selected,
      })),
    },
    {
      items: [
        { id: 'ungroup', text: 'UNGROUP' },
        { id: 'delete', text: 'DELETE GROUP' },
      ],
    },
  ];
  const pickCommand = (id: string) => {
    if (id === 'move:up' || id === 'move:down') {
      onMoveGroup(group.id, id === 'move:up' ? -1 : 1);
    } else if (id === 'ungroup') {
      onRemoveGroup(group.id);
    } else if (id === 'delete') {
      onDeleteGroup(group.id);
    } else {
      const choice = colorChoices.find((candidate) => candidate.id === id.slice('color:'.length));
      if (choice !== undefined) {
        onSetGroupColor(group.id, choice.value);
      }
    }
  };
  return (
    <div className="view-group__header">
      {handle}
      {membersId === undefined ? (
        <span className="group-collapse is-placeholder" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="group-collapse"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${group.name}`}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : membersId}
          // A drag never has to worry about its own rows disappearing under it.
          disabled={saving || dragging}
          onClick={() => onToggleCollapse(group.id)}
        >
          <Chevron collapsed={collapsed} />
        </button>
      )}
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
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
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
      <PaletteControl
        choices={colorChoices}
        menuLabel={`Group ${group.name} color menu`}
        disabled={saving}
        onSelect={(color) => onSetGroupColor(group.id, color)}
      />
      <DeleteButton
        label={`Delete group ${group.name}`}
        title="Delete group and its channels"
        disabled={saving || dragging}
        onClick={() => onDeleteGroup(group.id)}
      />
      <RowMenu
        label={`Group ${group.name} menu`}
        sections={menuSections}
        disabled={saving || dragging}
        onPick={pickCommand}
      />
    </div>
  );
}

/** A group with members: a sortable block in the root list and a drop container for channels. */
export function SortableGroupBlock(props: GroupBlockProps) {
  const { group, entries, rowKeys, itemIds, saving, collapsed, renderRow } = props;
  const leadKind = leadChannelKind(entries);
  const membersId = `view-group-${group.id}-members`;
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
    data: {
      kind: 'groupzone',
      label: `group ${group.name}`,
      groupId: group.id,
      empty: false,
      collapsed,
    },
    disabled: saving,
  });
  const isDropTarget = useIsDropTarget(group.id);
  const style = {
    '--channel-row-accent': groupAccent(group, leadKind),
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setZoneRef(node);
      }}
      className={`view-group ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      data-flip-key={groupRowKey(group.id)}
      data-flip-skip={isDragging ? '' : undefined}
      data-view-group-id={group.id}
      style={style}
    >
      <GroupHeader
        {...props}
        membersId={membersId}
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
      {/* Collapsed members are unmounted, not hidden: a hidden row still registers a droppable
          with an empty rectangle, which a keyboard drag would happily aim at. */}
      {!collapsed && (
        <SortableContext items={itemIds} strategy={previewSortingStrategy}>
          <ol className="view-group__members" id={membersId}>
            {entries.map((entry, position) => renderRow(entry, rowKeys[position] ?? ''))}
          </ol>
        </SortableContext>
      )}
    </li>
  );
}

/** A group without members: only a drop container, always listed after the ordered blocks. */
export function EmptyGroupBlock(props: Omit<GroupBlockProps, 'renderRow' | 'rowKeys' | 'itemIds'>) {
  const { group, saving } = props;
  const { setNodeRef } = useDroppable({
    id: groupZoneDndId(group.id),
    data: {
      kind: 'groupzone',
      label: `group ${group.name}`,
      groupId: group.id,
      empty: true,
      collapsed: false,
    },
    disabled: saving,
  });
  const isDropTarget = useIsDropTarget(group.id);
  return (
    <li
      ref={setNodeRef}
      className={`view-group ${isDropTarget ? 'is-drop-target' : ''}`}
      data-flip-key={groupRowKey(group.id)}
      data-view-group-id={group.id}
      style={{ '--channel-row-accent': groupAccent(group, undefined) } as CSSProperties}
    >
      <GroupHeader
        {...props}
        handle={<span className="drag-handle is-placeholder" aria-hidden="true" />}
      />
      <p className="view-group__empty">ASSIGN CHANNELS BELOW</p>
    </li>
  );
}
