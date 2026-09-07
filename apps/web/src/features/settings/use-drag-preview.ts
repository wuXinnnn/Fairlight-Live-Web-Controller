import { createContext, useContext } from 'react';
import type { DndItemKind } from './dnd-ids.js';
import type { DragPreview } from './drag-preview.js';
import type { DragSource } from './drop-resolver.js';

export interface DragPreviewState {
  /** True while any drag on the page is in progress. */
  dragging: boolean;
  /** What is being dragged; null while idle. */
  sourceKind: DndItemKind | null;
  /** Where the dragged item is in the rendered view (the preview view while one exists). */
  source: DragSource | null;
  /** The view to render while the dragged item is previewed in another container. */
  preview: DragPreview | null;
  /** True while releasing would remove the dragged item from the view. */
  removing: boolean;
}

export const IDLE_DRAG_PREVIEW: DragPreviewState = {
  dragging: false,
  sourceKind: null,
  source: null,
  preview: null,
  removing: false,
};

export const DragPreviewContext = createContext<DragPreviewState>(IDLE_DRAG_PREVIEW);

/** Drag state shared with the lists so they can show placeholders and lock scrolling. */
export function useDragPreview(): DragPreviewState {
  return useContext(DragPreviewContext);
}
