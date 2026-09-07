import { useDraggable } from '@dnd-kit/core';
import type { ChannelState } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { channelTypeColor } from '../mixer/channel-colors.js';
import { channelNameKey } from '../mixer/view-resolver.js';
import { KIND_LABELS } from './channel-labels.js';
import { availableDndId } from './dnd-ids.js';
import { DragHandle } from './DragHandle.js';
import { useDragPreview } from './use-drag-preview.js';

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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: availableDndId(channel.id),
    data: { kind: 'available', label: channel.name, channelId: channel.id },
    disabled,
  });
  const style = { '--channel-row-accent': channelTypeColor(channel.kind) } as CSSProperties;
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
        // A click that never became a drag must not act as a click on the label around it.
        onClick={(event) => event.preventDefault()}
      />
    </label>
  );
}

/**
 * The entry of a channel whose placeholder is currently shown in the CHANNEL ORDER list. It keeps
 * the row in place but registers no draggable, because the placeholder now owns the drag's id.
 */
function PreviewedAvailableChannel({
  channel,
  duplicate,
}: Pick<AvailableChannelProps, 'channel' | 'duplicate'>) {
  return (
    <label
      className="is-dragging"
      data-available-channel-id={channel.id}
      style={{ '--channel-row-accent': channelTypeColor(channel.kind) } as CSSProperties}
    >
      <input type="checkbox" checked={false} readOnly />
      <span className="channel-checklist__box" aria-hidden="true" />
      <span className="channel-checklist__accent" aria-hidden="true" />
      <strong>{channel.name}</strong>
      <small>
        {KIND_LABELS[channel.kind]}
        {duplicate && <em className="channel-order__flag">DUPLICATE NAME</em>}
      </small>
      <span className="drag-handle is-placeholder" aria-hidden="true" />
    </label>
  );
}

/**
 * AVAILABLE CHANNELS: a checkbox per live channel (append to or remove from the view) plus a
 * drag handle that drops an unchecked channel anywhere in the CHANNEL ORDER list. The list locks
 * its own scrolling while a drag is in progress.
 */
export function AvailableChannelList({
  channels,
  assignedChannelIds,
  duplicateNames,
  saving,
  onToggle,
}: AvailableChannelListProps) {
  const { dragging, preview } = useDragPreview();
  return (
    <div className={`channel-checklist ${dragging ? 'is-drag-locked' : ''}`}>
      {channels.map((channel) => {
        const duplicate = duplicateNames.has(channelNameKey(channel.kind, channel.name));
        return preview?.placeholderChannelId === channel.id ? (
          <PreviewedAvailableChannel key={channel.id} channel={channel} duplicate={duplicate} />
        ) : (
          <AvailableChannel
            key={channel.id}
            channel={channel}
            checked={assignedChannelIds.has(channel.id)}
            duplicate={duplicate}
            saving={saving}
            onToggle={onToggle}
          />
        );
      })}
    </div>
  );
}
