import type { CSSProperties } from 'react';
import { useDragPreview } from './use-drag-preview.js';

export type DragOverlayVariant = 'row' | 'group' | 'available';

interface DragOverlayContentProps {
  variant: DragOverlayVariant;
  /** Name of the dragged channel or group. */
  label: string;
  /** Accent colour of the dragged item, resolved by the page from the live channel or group. */
  accent: string;
  /** Secondary text: channel kind for rows, member count for groups. */
  detail: string;
}

/**
 * The clone that follows the pointer. It is drawn in the DragOverlay portal, so it is never
 * clipped or scrolled by the list containers, and turns red once releasing would remove the item.
 * Everything it shows comes from props: dnd-kit keeps rendering the last clone while the drop
 * animation plays, after the active item is already gone.
 */
export function DragOverlayContent({ variant, label, accent, detail }: DragOverlayContentProps) {
  const { removing } = useDragPreview();
  return (
    <div
      className={`drag-overlay drag-overlay--${variant} ${removing ? 'is-removing' : ''}`}
      style={{ '--channel-row-accent': accent } as CSSProperties}
      aria-hidden="true"
    >
      <span className="drag-overlay__grip" />
      <span className="channel-order__accent" />
      <strong>{label}</strong>
      <small>{removing ? 'DROP TO REMOVE' : detail}</small>
    </div>
  );
}
