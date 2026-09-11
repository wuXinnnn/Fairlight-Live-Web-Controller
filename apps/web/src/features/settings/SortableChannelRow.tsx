import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CHANNEL_PALETTE_KEYS,
  type ChannelKind,
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
import { moveChannel, type MoveDirection } from './view-order.js';

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
  /** Kind of the group's first present member, which is what a group without a colour takes. */
  groupLeadKind?: ChannelKind;
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
  groupLeadKind,
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
  const groupId = view.groups.some((group) => group.id === reference.groupId)
    ? reference.groupId
    : undefined;
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
    '--channel-row-accent': channelAccent(kind, reference.color, group, groupLeadKind),
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
          value={reference.groupId ?? ''}
          onChange={(event) => onAssignGroup(index, event.target.value || undefined)}
        >
          <option value="">NO GROUP</option>
          {view.groups.map((group) => (
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
    </li>
  );
}
