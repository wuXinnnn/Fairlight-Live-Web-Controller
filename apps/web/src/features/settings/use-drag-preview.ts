import { createContext, useContext } from 'react';
import type { DragPreview } from './drag-preview.js';

export interface DragPreviewState {
  /** True while any drag on the page is in progress. */
  dragging: boolean;
  /** The view to render while the dragged item is previewed in another container. */
  preview: DragPreview | null;
  /** True while releasing would remove the dragged item from the view. */
  removing: boolean;
}

export const IDLE_DRAG_PREVIEW: DragPreviewState = {
  dragging: false,
  preview: null,
  removing: false,
};

export const DragPreviewContext = createContext<DragPreviewState>(IDLE_DRAG_PREVIEW);

/** Drag state shared with the lists so they can show placeholders and lock scrolling. */
export function useDragPreview(): DragPreviewState {
  return useContext(DragPreviewContext);
}
