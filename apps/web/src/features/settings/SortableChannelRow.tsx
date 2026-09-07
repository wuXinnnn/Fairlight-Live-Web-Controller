import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CHANNEL_PALETTE_KEYS, type ChannelPaletteKey, type View } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { CHANNEL_PALETTE, channelColor } from '../mixer/channel-colors.js';
import { channelNameKey, type ResolvedViewChannel } from '../mixer/view-resolver.js';
import { KIND_LABELS, PALETTE_LABELS, pad } from './channel-labels.js';
import { channelDndId, type DndItemData } from './dnd-ids.js';
import { DragHandle } from './DragHandle.js';
import { OrderButtons } from './OrderButtons.js';
import { moveChannel, type MoveDirection } from './view-order.js';

export interface ChannelRowHandlers {
  onMoveChannel(index: number, direction: MoveDirection): void;
  onAssignGroup(index: number, groupId: string | undefined): void;
  onSetColor(index: number, color?: ChannelPaletteKey): void;
}

interface SortableChannelRowProps extends ChannelRowHandlers {
  entry: ResolvedViewChannel;
  view: View;
  rowKey: string;
  duplicateNames: Set<string>;
  channelInventoryLoaded: boolean;
  saving: boolean;
}

/** One channel reference of the view: sortable inside its list, with the row's own controls. */
export function SortableChannelRow({
  entry,
  view,
  rowKey,
  duplicateNames,
  channelInventoryLoaded,
  saving,
  onMoveChannel,
  onAssignGroup,
  onSetColor,
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
  });
  const style = {
    '--channel-row-accent': channelColor(kind, reference.color),
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  return (
    <li
      ref={setNodeRef}
      className={`channel-order-row ${missing ? 'is-missing' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-flip-key={rowKey}
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
        canMoveUp={moveChannel(view, index, -1) !== null}
        canMoveDown={moveChannel(view, index, 1) !== null}
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
      <div className="palette-control">
        <button
          type="button"
          className={reference.color === undefined ? 'is-selected' : ''}
          aria-label={`${reference.name} use default color`}
          title="Type default"
          onClick={() => onSetColor(index)}
        >
          AUTO
        </button>
        {CHANNEL_PALETTE_KEYS.map((color) => (
          <button
            type="button"
            key={color}
            className={reference.color === color ? 'is-selected' : ''}
            aria-label={`${reference.name} color ${PALETTE_LABELS[color]}`}
            title={PALETTE_LABELS[color]}
            style={{ '--swatch': CHANNEL_PALETTE[color] } as CSSProperties}
            onClick={() => onSetColor(index, color)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </li>
  );
}
