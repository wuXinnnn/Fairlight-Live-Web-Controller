import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import type { ChannelState, View } from '@flwc/shared';
import type { ReactNode } from 'react';
import { referenceForChannel } from '../mixer/view-resolver.js';
import { viewCollisionDetection, viewKeyboardCoordinates } from './dnd-collision.js';
import {
  POINTER_ACTIVATION_DISTANCE_PX,
  TOUCH_ACTIVATION_DELAY_MS,
  TOUCH_ACTIVATION_TOLERANCE_PX,
} from './dnd-config.js';
import { readItemData } from './dnd-ids.js';
import { dragSourceFor, resolveDropTarget } from './drop-resolver.js';
import { insertChannelAt, moveChannelTo, moveGroupTo } from './view-order.js';

interface ViewDndContextProps {
  /** Live channels by id, used to build the reference for a dropped AVAILABLE channel. */
  channels: Record<string, ChannelState | undefined>;
  /** Live channel ids already referenced by the draft; dropping them again is a no-op. */
  assignedChannelIds: ReadonlySet<string>;
  /** Applies a pure update to the draft; the update returns null to leave the draft unchanged. */
  onDrop(update: (source: View) => View | null): void;
  /** Called right before the draft changes, while the list still shows the drag state. */
  onBeforeDrop?(): void;
  children: ReactNode;
}

function labelOf(entry: Active | Over | null): string {
  return readItemData(entry)?.label ?? 'item';
}

const announcements = {
  onDragStart: ({ active }: { active: Active }) => `Picked up ${labelOf(active)}.`,
  onDragOver: ({ active, over }: { active: Active; over: Over | null }) =>
    over === null
      ? `${labelOf(active)} is no longer over a drop target.`
      : `${labelOf(active)} is over ${labelOf(over)}.`,
  onDragEnd: ({ active, over }: { active: Active; over: Over | null }) =>
    over === null
      ? `${labelOf(active)} was dropped without a target.`
      : `${labelOf(active)} was dropped over ${labelOf(over)}.`,
  onDragCancel: ({ active }: { active: Active }) => `Dragging ${labelOf(active)} was cancelled.`,
};

const screenReaderInstructions = {
  draggable:
    'To pick up a channel or group, press Space or Enter on its drag handle. ' +
    'Use the up and down arrow keys to move it, press Space or Enter again to drop it, ' +
    'or press Escape to cancel.',
};

/** Whether the dragged item was released below the midpoint of the row it is over. */
function droppedAfter(active: Active, over: Over): boolean {
  const translated = active.rect.current.translated;
  if (translated === null) {
    return false;
  }
  return translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2;
}

/**
 * Drag and drop for the configuration page. Pointer, touch and keyboard sensors are enabled;
 * a drop is resolved against the draft the moment it is committed, so a stale identifier is a
 * no-op rather than a wrong move.
 */
export function ViewDndContext({
  channels,
  assignedChannelIds,
  onDrop,
  onBeforeDrop,
  children,
}: ViewDndContextProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY_MS,
        tolerance: TOUCH_ACTIVATION_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: viewKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || over.id === active.id) {
      return;
    }
    const hint = { after: droppedAfter(active, over) };
    onBeforeDrop?.();
    onDrop((source) => {
      const drag = dragSourceFor(source, active.id);
      if (drag === null) {
        return null;
      }
      const target = resolveDropTarget(source, drag, over.id, hint);
      if (target === null) {
        return null;
      }
      switch (drag.kind) {
        case 'channel':
          return moveChannelTo(source, drag.index, target);
        case 'group':
          return target.kind === 'root' ? moveGroupTo(source, drag.groupId, target.position) : null;
        case 'available': {
          const channel = channels[drag.channelId];
          if (channel === undefined || assignedChannelIds.has(drag.channelId)) {
            return null;
          }
          return insertChannelAt(source, referenceForChannel(channel), target);
        }
      }
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={viewCollisionDetection}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DndContext>
  );
}
