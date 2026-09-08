import { useDndContext } from '@dnd-kit/core';
import { useLayoutEffect } from 'react';

interface DroppableRemeasureProps {
  /** Changes whenever the lists were re-rendered from a new preview view. */
  trigger: unknown;
}

/**
 * Re-measures every droppable after the lists re-render from a preview view. dnd-kit only
 * re-measures the items of the sortable list whose order changed, but a block that moves in the
 * root list shifts the rows of every group below it, and those would otherwise keep stale
 * rectangles until dnd-kit's periodic measurement catches up.
 */
export function DroppableRemeasure({ trigger }: DroppableRemeasureProps) {
  const { measureDroppableContainers } = useDndContext();
  useLayoutEffect(() => {
    measureDroppableContainers([]);
  }, [trigger, measureDroppableContainers]);
  return null;
}
