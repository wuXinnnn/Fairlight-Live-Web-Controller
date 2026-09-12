import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CHANNEL_PALETTE_KEYS,
  viewGroups,
  type View,
  type ViewChannelColor,
  type ViewGroup,
} from '@flwc/shared';
import type { CSSProperties } from 'react';
import { CHANNEL_PALETTE, channelAccent } from '../mixer/channel-colors.js';
import { channelNameKey, type ResolvedViewChannel } from '../mixer/view-resolver.js';
import { KIND_LABELS, PALETTE_LABELS, pad } from './channel-labels.js';
import { channelDndId, type DndItemData } from './dnd-ids.js';
import { DeleteButton } from './DeleteButton.js';
import { DragHandle } from './DragHandle.js';
import { OrderButtons } from './OrderButtons.js';
import { PaletteControl, type PaletteChoice } from './PaletteControl.js';
import { RowMenu, type RowMenuSection } from './RowMenu.js';
import { groupOfIndex, moveChannel, type MoveDirection } from './view-order.js';

export interface ChannelRowHandlers {
  onMoveChannel(index: number, direction: MoveDirection): void;
  onAssignGroup(index: number, groupId: string | undefined): void;
  onSetColor(index: number, color?: ViewChannelColor): void;
  onDeleteChannel(index: number): void;
}

interface SortableChannelRowProps extends ChannelRowHandlers {
  entry: ResolvedViewChannel;
  view: View;
  rowKey: string;
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
  /** True while any drag is in progress; the row then renders a preview index, not a draft one. */
  dragging: boolean;
  /** The group this row belongs to, when it has one; its colour is what GROUP follows. */
  group?: ViewGroup;
}

/** One channel reference of the view: sortable inside its list, with the row's own controls. */
export function SortableChannelRow({
  entry,
  view,
  rowKey,
  duplicateNames,
  channelInventoryLoaded,
  saving,
  dragging,
  group,
  onMoveChannel,
  onAssignGroup,
  onSetColor,
  onDeleteChannel,
}: SortableChannelRowProps) {
  const { reference, channel, index } = entry;
  const missing = channelInventoryLoaded && channel === undefined;
  const kind = channel?.kind ?? reference.kind;
  const duplicate =
    channel !== undefined && duplicateNames.has(channelNameKey(channel.kind, channel.name));
  const groupId = groupOfIndex(view, index)?.id;
  const data: DndItemData =
    groupId === undefined
      ? { kind: 'channel', label: reference.name }
      : { kind: 'channel', label: reference.name, groupId };
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: channelDndId(rowKey),
    data,
    disabled: saving,
    animateLayoutChanges: () => false,
    transition: null,
  });
  const style = {
    '--channel-row-accent': channelAccent(kind, reference.color, group),
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  const colorChoices: PaletteChoice<ViewChannelColor | undefined>[] = [
    {
      id: 'auto',
      value: undefined,
      ariaLabel: `${reference.name} use default color`,
      title: 'Type default',
      text: 'AUTO',
      selected: reference.color === undefined,
    },
  ];
  if (group !== undefined) {
    // A swatch here would repeat whichever palette colour the group holds, leaving two identical
    // squares in one row; the abbreviation says what the choice means instead.
    colorChoices.push({
      id: 'group',
      value: 'group',
      ariaLabel: `${reference.name} use group color`,
      title: `Group ${group.name}`,
      text: 'GRP',
      selected: reference.color === 'group',
    });
  }
  for (const color of CHANNEL_PALETTE_KEYS) {
    colorChoices.push({
      id: color,
      value: color,
      ariaLabel: `${reference.name} color ${PALETTE_LABELS[color]}`,
      title: PALETTE_LABELS[color],
      swatch: CHANNEL_PALETTE[color],
      selected: reference.color === color,
    });
  }
  const canMoveUp = moveChannel(view, index, -1) !== null;
  const canMoveDown = moveChannel(view, index, 1) !== null;
  // The same commands the row lays out beside each other, for a column that cannot hold them.
  const menuSections: RowMenuSection[] = [
    {
      label: 'ORDER',
      items: [
        { id: 'move:up', text: 'MOVE UP', disabled: !canMoveUp },
        { id: 'move:down', text: 'MOVE DOWN', disabled: !canMoveDown },
      ],
    },
    {
      label: 'GROUP',
      items: [
        { id: 'group:', text: 'NO GROUP', selected: groupId === undefined },
        ...viewGroups(view).map((candidate) => ({
          id: `group:${candidate.id}`,
          text: candidate.name,
          selected: candidate.id === groupId,
        })),
      ],
    },
    {
      // Derived from the palette's own choices, so the two shapes cannot drift apart.
      label: 'COLOR',
      items: colorChoices.map((choice) => ({
        id: `color:${choice.id}`,
        text: choice.text ?? choice.title,
        selected: choice.selected,
      })),
    },
    { items: [{ id: 'delete', text: 'REMOVE FROM VIEW' }] },
  ];
  const pickCommand = (id: string) => {
    if (id === 'move:up' || id === 'move:down') {
      onMoveChannel(index, id === 'move:up' ? -1 : 1);
    } else if (id === 'delete') {
      onDeleteChannel(index);
    } else if (id.startsWith('group:')) {
      onAssignGroup(index, id.slice('group:'.length) || undefined);
    } else {
      const choice = colorChoices.find((candidate) => candidate.id === id.slice('color:'.length));
      if (choice !== undefined) {
        onSetColor(index, choice.value);
      }
    }
  };
  return (
    <li
      ref={setNodeRef}
      className={`channel-order-row ${missing ? 'is-missing' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-flip-key={rowKey}
      data-flip-skip={isDragging ? '' : undefined}
      data-ordered-channel-id={channel?.id ?? reference.channelId}
      data-ordered-channel-name={reference.name}
      style={style}
    >
      <DragHandle
        label={`Drag ${reference.name}`}
        handleRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
        disabled={saving}
      />
      <div className="channel-order__index">{pad(index + 1)}</div>
      <span className="channel-order__accent" aria-hidden="true" />
      <div className="channel-order__identity">
        <strong>{channel?.name ?? reference.name}</strong>
        <small>
          {!channelInventoryLoaded ? 'WAITING' : missing ? 'MISSING' : KIND_LABELS[kind]}
          {duplicate && <em className="channel-order__flag">DUPLICATE NAME</em>}
        </small>
      </div>
      <OrderButtons
        label={reference.name}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMove={(direction) => onMoveChannel(index, direction)}
      />
      <label className="group-control">
        <span>GROUP</span>
        <select
          aria-label={`${reference.name} group`}
          value={groupId ?? ''}
          onChange={(event) => onAssignGroup(index, event.target.value || undefined)}
        >
          <option value="">NO GROUP</option>
          {viewGroups(view).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <PaletteControl
        choices={colorChoices}
        menuLabel={`${reference.name} color menu`}
        onSelect={(color) => onSetColor(index, color)}
      />
      {/* A drag renders preview indices, so the row would delete whatever now sits at its place. */}
      <DeleteButton
        label={`Remove ${reference.name}`}
        title="Remove from view"
        disabled={saving || dragging}
        onClick={() => onDeleteChannel(index)}
      />
      <RowMenu
        label={`${reference.name} menu`}
        sections={menuSections}
        disabled={saving || dragging}
        onPick={pickCommand}
      />
    </li>
  );
}
