import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type Over,
} from '@dnd-kit/core';
import type { ChannelState, View } from '@flwc/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { channelColor, channelTypeColor } from '../mixer/channel-colors.js';
import { referenceForChannel } from '../mixer/view-resolver.js';
import { KIND_LABELS, pad } from './channel-labels.js';
import { viewCollisionDetection, viewKeyboardCoordinates } from './dnd-collision.js';
import {
  POINTER_ACTIVATION_DISTANCE_PX,
  REMOVE_DRAG_THRESHOLD_PX,
  TOUCH_ACTIVATION_DELAY_MS,
  TOUCH_ACTIVATION_TOLERANCE_PX,
} from './dnd-config.js';
import { readItemData } from './dnd-ids.js';
import {
  containerOf,
  dropAnimationFor,
  eventPoint,
  pointerOutside,
  previewFor,
  removalFor,
  sameContainer,
  settlePreview,
  type DragPreview,
  type ListContainer,
  type Point,
} from './drag-preview.js';
import { DragOverlayContent, type DragOverlayVariant } from './DragOverlayContent.js';
import { dragSourceFor, resolveDropTarget, type DragSource } from './drop-resolver.js';
import { ListAutoScroller } from './ListAutoScroller.js';
import {
  DragPreviewContext,
  IDLE_DRAG_PREVIEW,
  type DragPreviewState,
} from './use-drag-preview.js';
import { insertChannelAt, moveChannelTo, moveGroupTo } from './view-order.js';

interface ViewDndContextProps {
  /** The draft being edited; null while no view is selected. */
  view: View | null;
  /** Live channels by id, used to build the reference for a dropped AVAILABLE channel. */
  channels: Record<string, ChannelState | undefined>;
  /** Live channel ids already referenced by the draft; dropping them again is a no-op. */
  assignedChannelIds: ReadonlySet<string>;
  /** The CHANNEL ORDER list element: the auto-scroll target and the bounds for drag-out removal. */
  listRef: RefObject<HTMLOListElement | null>;
  /** Applies a pure update to the draft; the update returns null to leave the draft unchanged. */
  onDrop(update: (source: View) => View | null): void;
  /** Called right before the draft changes, while the list still shows the drag state. */
  onBeforeDrop?(): void;
  children: ReactNode;
}

interface DragState {
  /** The draft when the drag started; drops are resolved against it. */
  startView: View;
  source: DragSource;
  /** Name shown on the drag overlay. */
  label: string;
  preview: DragPreview | null;
  removing: boolean;
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
    'or press Escape to cancel. With a pointer, drag an item out of the list to remove it.',
};

/** Whether the dragged item was released below the midpoint of the row it is over. */
function droppedAfter(active: Active, over: Over): boolean {
  const translated = active.rect.current.translated;
  if (translated === null) {
    return false;
  }
  return translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2;
}

/** The list the droppable under the pointer belongs to. */
function containerOfOver(over: Over): ListContainer | null {
  const data = readItemData(over);
  if (data === undefined) {
    return null;
  }
  switch (data.kind) {
    case 'channel':
    case 'available':
      return data.groupId === undefined
        ? { kind: 'root' }
        : { kind: 'group', groupId: data.groupId };
    case 'groupzone':
      return { kind: 'group', groupId: data.groupId };
    case 'group':
      return { kind: 'root' };
  }
}

/**
 * Drag and drop for the configuration page. Pointer, touch and keyboard sensors are enabled.
 * While an item is dragged into another list the page renders a preview view with the item
 * already there, so the placeholder shows where it will land; inside one list dnd-kit's sortable
 * strategy previews the move. The draft only changes when the drag ends.
 */
export function ViewDndContext({
  view,
  channels,
  assignedChannelIds,
  listRef,
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
  const [drag, setDrag] = useState<DragState | null>(null);
  // Drag handlers read the latest state without waiting for a render.
  const dragRef = useRef<DragState | null>(null);
  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);
  // Kept outside the drag state so it is still set in the render where dnd-kit clones the
  // overlay for its drop animation, after the drag state has already been cleared.
  const [dropAnimation, setDropAnimation] = useState<DropAnimation | null>(null);

  // The pointer is tracked directly: dnd-kit's deltas include scroll compensation, so they no
  // longer describe where the finger is once the list auto-scrolls.
  const pointerRef = useRef<Point | null>(null);
  useEffect(() => {
    if (drag === null) {
      return undefined;
    }
    const onPointerMove = (event: PointerEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch !== undefined) {
        pointerRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [drag]);

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    pointerRef.current = eventPoint(activatorEvent);
    if (view === null) {
      return;
    }
    const source = dragSourceFor(view, active.id);
    if (source === null) {
      update(null);
      return;
    }
    setDropAnimation(dropAnimationFor(source, false));
    update({ startView: view, source, label: labelOf(active), preview: null, removing: false });
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const state = dragRef.current;
    if (state === null) {
      return;
    }
    const currentView = state.preview?.view ?? state.startView;
    const currentSource = state.preview?.source ?? state.source;
    if (over === null) {
      // An AVAILABLE channel that leaves the list takes its placeholder with it.
      if (state.source.kind === 'available' && state.preview !== null) {
        update({ ...state, preview: null });
      }
      return;
    }
    if (over.id === active.id) {
      return;
    }
    const from = containerOf(currentView, currentSource);
    const to = containerOfOver(over);
    if (to === null || sameContainer(from, to)) {
      return;
    }
    const target = resolveDropTarget(currentView, currentSource, over.id, {
      after: droppedAfter(active, over),
    });
    if (target === null) {
      return;
    }
    const channel =
      state.source.kind === 'available' ? channels[state.source.channelId] : undefined;
    const next = previewFor(currentView, currentSource, target, channel);
    if (next === null) {
      return;
    }
    const placeholderChannelId = next.placeholderChannelId ?? state.preview?.placeholderChannelId;
    update({
      ...state,
      preview: placeholderChannelId === undefined ? next : { ...next, placeholderChannelId },
    });
  };

  const handleDragMove = () => {
    const state = dragRef.current;
    const list = listRef.current;
    if (state === null || state.source.kind === 'available' || list === null) {
      return;
    }
    const pointer = pointerRef.current;
    const removing =
      pointer !== null &&
      pointerOutside(pointer, list.getBoundingClientRect(), REMOVE_DRAG_THRESHOLD_PX);
    if (removing !== state.removing) {
      update({ ...state, removing });
    }
  };

  const finalViewFor = (state: DragState, active: Active, over: Over | null): View | null => {
    if (state.removing) {
      return removalFor(state.startView, state.source);
    }
    if (over === null) {
      return null;
    }
    const hint = { after: droppedAfter(active, over) };
    if (state.preview !== null) {
      return settlePreview(state.preview, active.id, over.id, hint);
    }
    if (over.id === active.id) {
      return null;
    }
    const target = resolveDropTarget(state.startView, state.source, over.id, hint);
    if (target === null) {
      return null;
    }
    switch (state.source.kind) {
      case 'channel':
        return moveChannelTo(state.startView, state.source.index, target);
      case 'group':
        return target.kind === 'root'
          ? moveGroupTo(state.startView, state.source.groupId, target.position)
          : null;
      case 'available': {
        const channel = channels[state.source.channelId];
        if (channel === undefined || assignedChannelIds.has(state.source.channelId)) {
          return null;
        }
        return insertChannelAt(state.startView, referenceForChannel(channel), target);
      }
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const state = dragRef.current;
    pointerRef.current = null;
    if (state === null) {
      update(null);
      return;
    }
    setDropAnimation(dropAnimationFor(state.source, state.removing));
    update(null);
    const finalView = finalViewFor(state, active, over);
    if (finalView === null) {
      return;
    }
    onBeforeDrop?.();
    // The draft cannot have changed during the drag; if it somehow did, drop the stale result.
    onDrop((source) => (source === state.startView ? finalView : null));
  };

  const handleDragCancel = () => {
    const state = dragRef.current;
    pointerRef.current = null;
    if (state !== null) {
      // The overlay flies back to the row it was picked up from.
      setDropAnimation(dropAnimationFor(state.source, false));
    }
    update(null);
  };

  const previewState = useMemo<DragPreviewState>(
    () =>
      drag === null
        ? IDLE_DRAG_PREVIEW
        : { dragging: true, preview: drag.preview, removing: drag.removing },
    [drag],
  );

  const overlay = useMemo(() => {
    if (drag === null) {
      return null;
    }
    const current = drag.preview?.view ?? drag.startView;
    const variant: DragOverlayVariant =
      drag.source.kind === 'group'
        ? 'group'
        : drag.source.kind === 'available'
          ? 'available'
          : 'row';
    const label = variant === 'group' ? drag.label.replace(/^group /, '') : drag.label;
    switch (drag.source.kind) {
      case 'channel': {
        const reference = drag.startView.channels[drag.source.index];
        const live = reference?.channelId === undefined ? undefined : channels[reference.channelId];
        const kind = live?.kind ?? reference?.kind ?? 'channel';
        return {
          variant,
          label,
          accent: channelColor(kind, reference?.color),
          detail: KIND_LABELS[kind],
        };
      }
      case 'group': {
        const groupId = drag.source.groupId;
        const members = current.channels.filter((reference) => reference.groupId === groupId);
        const lead = members[0];
        const live = lead?.channelId === undefined ? undefined : channels[lead.channelId];
        return {
          variant,
          label,
          accent: channelColor(live?.kind ?? lead?.kind ?? 'channel', lead?.color),
          detail: `${pad(members.length)} CH`,
        };
      }
      case 'available': {
        const channel = channels[drag.source.channelId];
        const kind = channel?.kind ?? 'channel';
        return { variant, label, accent: channelTypeColor(kind), detail: KIND_LABELS[kind] };
      }
    }
  }, [channels, drag]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={viewCollisionDetection}
      accessibility={{ announcements, screenReaderInstructions }}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DragPreviewContext.Provider value={previewState}>
        {children}
        <ListAutoScroller listRef={listRef} pointerRef={pointerRef} />
        <DragOverlay dropAnimation={dropAnimation}>
          {overlay === null ? null : <DragOverlayContent {...overlay} />}
        </DragOverlay>
      </DragPreviewContext.Provider>
    </DndContext>
  );
}
