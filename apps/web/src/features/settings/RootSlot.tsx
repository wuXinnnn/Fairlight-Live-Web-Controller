import { useDroppable } from '@dnd-kit/core';
import type { CSSProperties } from 'react';
import { ROOT_SLOT_HEIGHT_PX } from './dnd-config.js';
import { rootSlotDndId, type DndItemData } from './dnd-ids.js';

interface RootSlotProps {
  /** Number of blocks above this boundary. */
  position: number;
  /** Where the slot is, for screen reader announcements. */
  label: string;
  /** True when the dragged row already sits here; keyboard moves skip it, pointers stay put. */
  current: boolean;
  /**
   * True for the slot at the end of the list. It takes the space the list has left instead of
   * overlaying the block below, so the empty area under the last block is a drop target: the
   * one place a channel, an AVAILABLE entry or a whole group can be sent to the end.
   */
  fill?: boolean;
}

/**
 * A drop target at a block boundary that has no ungrouped row next to it: before a group that
 * starts the list, between two groups, or after a group that ends the list. It only exists while
 * a channel is dragged. The list item takes no space; its band overlays the first pixels below
 * the boundary, so slots appearing and disappearing never shift the rows under the pointer.
 * Hovering the band previews the channel there as an ungrouped row, which replaces the slot.
 */
export function RootSlot({ position, label, current, fill = false }: RootSlotProps) {
  const data: DndItemData = { kind: 'slot', label, position, current, fill };
  const { setNodeRef } = useDroppable({ id: rootSlotDndId(position, fill), data });
  return (
    <li className={`root-slot ${fill ? 'root-slot--fill' : ''}`} aria-hidden="true">
      <div
        ref={setNodeRef}
        className="root-slot__band"
        data-root-slot={position}
        data-root-slot-fill={fill ? '' : undefined}
        style={
          fill
            ? ({ minHeight: ROOT_SLOT_HEIGHT_PX } as CSSProperties)
            : ({ height: ROOT_SLOT_HEIGHT_PX } as CSSProperties)
        }
      />
    </li>
  );
}
