import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChannelKind } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { channelTypeColor } from '../mixer/channel-colors.js';
import { KIND_LABELS, pad } from './channel-labels.js';
import { availableDndId, type DndItemData } from './dnd-ids.js';

interface PlaceholderRowProps {
  channelId: string;
  name: string;
  kind: ChannelKind;
  index: number;
  rowKey: string;
  groupId?: string;
}

/**
 * Stands in for an AVAILABLE channel while it is dragged over the list. It is sortable under the
 * drag's own id, so dnd-kit keeps treating the dragged channel as the active item once it is here.
 */
export function PlaceholderRow({
  channelId,
  name,
  kind,
  index,
  rowKey,
  groupId,
}: PlaceholderRowProps) {
  const data: DndItemData =
    groupId === undefined
      ? { kind: 'available', label: name, channelId }
      : { kind: 'available', label: name, channelId, groupId };
  const { setNodeRef, transform, transition } = useSortable({
    id: availableDndId(channelId),
    data,
    animateLayoutChanges: () => false,
  });
  const style = {
    '--channel-row-accent': channelTypeColor(kind),
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  return (
    <li
      ref={setNodeRef}
      className="channel-order-row is-dragging is-placeholder"
      data-flip-key={rowKey}
      data-ordered-channel-id={channelId}
      data-ordered-channel-name={name}
      data-placeholder="true"
      style={style}
      aria-hidden="true"
    >
      <span className="drag-handle is-placeholder" />
      <div className="channel-order__index">{pad(index + 1)}</div>
      <span className="channel-order__accent" />
      <div className="channel-order__identity">
        <strong>{name}</strong>
        <small>{KIND_LABELS[kind]}</small>
      </div>
    </li>
  );
}
