import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { ChannelState } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { channelTypeColor } from '../mixer/channel-colors.js';
import { channelNameKey } from '../mixer/view-resolver.js';
import { KIND_LABELS } from './channel-labels.js';
import { availableDndId } from './dnd-ids.js';
import { DragHandle } from './DragHandle.js';

interface AvailableChannelListProps {
  channels: ChannelState[];
  assignedChannelIds: ReadonlySet<string>;
  duplicateNames: Set<string>;
  saving: boolean;
  onToggle(channelId: string): void;
}

interface AvailableChannelProps {
  channel: ChannelState;
  checked: boolean;
  duplicate: boolean;
  saving: boolean;
  onToggle(channelId: string): void;
}

function AvailableChannel({
  channel,
  checked,
  duplicate,
  saving,
  onToggle,
}: AvailableChannelProps) {
  const disabled = checked || saving;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: availableDndId(channel.id),
      data: { kind: 'available', label: channel.name, channelId: channel.id },
      disabled,
    });
  const style = {
    '--channel-row-accent': channelTypeColor(channel.kind),
    transform: CSS.Translate.toString(transform),
  } as CSSProperties;
  return (
    <label
      ref={setNodeRef}
      className={`${checked ? 'is-checked' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-available-channel-id={channel.id}
      style={style}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(channel.id)} />
      <span className="channel-checklist__box" aria-hidden="true" />
      <span className="channel-checklist__accent" aria-hidden="true" />
      <strong>{channel.name}</strong>
      <small>
        {KIND_LABELS[channel.kind]}
        {duplicate && <em className="channel-order__flag">DUPLICATE NAME</em>}
      </small>
      <DragHandle
        label={`Drag ${channel.name}`}
        handleRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
        disabled={disabled}
      />
    </label>
  );
}

/**
 * AVAILABLE CHANNELS: a checkbox per live channel (append to or remove from the view) plus a
 * drag handle that drops an unchecked channel anywhere in the CHANNEL ORDER list.
 */
export function AvailableChannelList({
  channels,
  assignedChannelIds,
  duplicateNames,
  saving,
  onToggle,
}: AvailableChannelListProps) {
  return (
    <div className="channel-checklist">
      {channels.map((channel) => (
        <AvailableChannel
          key={channel.id}
          channel={channel}
          checked={assignedChannelIds.has(channel.id)}
          duplicate={duplicateNames.has(channelNameKey(channel.kind, channel.name))}
          saving={saving}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
