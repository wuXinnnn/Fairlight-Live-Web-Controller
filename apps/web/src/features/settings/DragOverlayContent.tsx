import { useDndContext } from '@dnd-kit/core';
import type { CSSProperties } from 'react';
import { readItemData } from './dnd-ids.js';
import { useDragPreview } from './use-drag-preview.js';

interface DragOverlayContentProps {
  /** Accent colour of the dragged item, resolved by the page from the live channel or group. */
  accent: string;
  /** Secondary text: channel kind for rows, member count for groups. */
  detail: string;
}

/**
 * The clone that follows the pointer. It is drawn in the DragOverlay portal, so it is never
 * clipped or scrolled by the list containers, and turns red once releasing would remove the item.
 */
export function DragOverlayContent({ accent, detail }: DragOverlayContentProps) {
  const { active } = useDndContext();
  const { removing } = useDragPreview();
  const data = readItemData(active);
  if (data === undefined) {
    return null;
  }
  const variant = data.kind === 'group' ? 'group' : data.kind === 'available' ? 'available' : 'row';
  return (
    <div
      className={`drag-overlay drag-overlay--${variant} ${removing ? 'is-removing' : ''}`}
      style={{ '--channel-row-accent': accent } as CSSProperties}
      aria-hidden="true"
    >
      <span className="drag-overlay__grip" />
      <span className="channel-order__accent" />
      <strong>{data.kind === 'group' ? data.label.replace(/^group /, '') : data.label}</strong>
      <small>{removing ? 'DROP TO REMOVE' : detail}</small>
    </div>
  );
}
