import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type Over,
} from '@dnd-kit/core';
import type { ChannelKind, ChannelState, View } from '@flwc/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { channelAccent, channelTypeColor, groupAccent } from '../mixer/channel-colors.js';
import { referenceForChannel } from '../mixer/view-resolver.js';
import { KIND_LABELS, pad } from './channel-labels.js';
import { viewCollisionDetection, viewKeyboardCoordinates } from './dnd-collision.js';
import {
  MOUSE_ACTIVATION_DISTANCE_PX,
  REMOVE_DRAG_THRESHOLD_PX,
  TOUCH_ACTIVATION_DELAY_MS,
  TOUCH_ACTIVATION_TOLERANCE_PX,
  VIEW_MEASURING,
} from './dnd-config.js';
import { readItemData } from './dnd-ids.js';
import {
  containerOf,
  dropAnimationFor,
  dropHintFor,
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
import { DroppableRemeasure } from './DroppableRemeasure.js';
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
  /** Ids of the groups whose members are hidden. */
  collapsedGroupIds: ReadonlySet<string>;
  /** Reveals a collapsed group the drag is about to drop into. */
  onExpandGroup(groupId: string): void;
  children: ReactNode;
}

interface DragState {
  /** The draft when the drag started; drops are resolved against it. */
  startView: View;
  source: DragSource;
  /** Name shown on the drag overlay. */
  label: string;
  /** True for pointer and touch drags; keyboard drags have no pointer to follow. */
  pointer: boolean;
  preview: DragPreview | null;
  removing: boolean;
  /**
   * Keyboard step the current preview was computed for. Expanding a group or shifting the rows
   * makes dnd-kit run collision detection again while the drag still aims where the last arrow
   * put it, and that stale aim can land on a neighbour; one arrow key means one move.
   */
  step: number;
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
    case 'slot':
      return { kind: 'root' };
  }
}

/**
 * Drag and drop for the configuration page. Mouse, touch and keyboard sensors are enabled, one
 * per input: the mouse starts a drag after MOUSE_ACTIVATION_DISTANCE_PX, a finger after resting
 * TOUCH_ACTIVATION_DELAY_MS on the handle, and neither can claim the other's press.
 * While an item is dragged the page renders a preview view with the item already where it would
 * land, inside its own list or another one, so the placeholder shows the drop; the preview is
 * kept in sync on every move. The draft only changes when the drag ends.
 */
export function ViewDndContext({
  view,
  channels,
  assignedChannelIds,
  listRef,
  onDrop,
  onBeforeDrop,
  collapsedGroupIds,
  onExpandGroup,
  children,
}: ViewDndContextProps) {
  // Direction of the last keyboard move; the drop hint has no pointer to read for those.
  const keyboardDownRef = useRef<boolean | null>(null);
  const keyboardStepRef = useRef(0);
  const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>((event, args) => {
    keyboardStepRef.current += 1;
    if (event.code === 'ArrowDown' || event.code === 'ArrowRight') {
      keyboardDownRef.current = true;
    } else if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') {
      keyboardDownRef.current = false;
    }
    return viewKeyboardCoordinates(event, args);
  }, []);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: MOUSE_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY_MS,
        tolerance: TOUCH_ACTIVATION_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
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
  // longer describe where the finger is once the list auto-scrolls. Only mouse and touch drags
  // track it: during a keyboard drag an idle mouse must not decide where the row lands.
  // `mousemove` is what the mouse sensor itself listens for and the only move event jsdom emits;
  // `pointermove` is kept as well so a browser that only sends pointer events still tracks.
  const pointerRef = useRef<Point | null>(null);
  useEffect(() => {
    if (drag === null || !drag.pointer) {
      return undefined;
    }
    const onMouseMove = (event: MouseEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch !== undefined) {
        pointerRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('pointermove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [drag]);

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    pointerRef.current = eventPoint(activatorEvent);
    keyboardDownRef.current = null;
    keyboardStepRef.current += 1;
    if (view === null) {
      return;
    }
    const source = dragSourceFor(view, active.id);
    if (source === null) {
      update(null);
      return;
    }
    setDropAnimation(dropAnimationFor(source, false));
    update({
      startView: view,
      source,
      label: labelOf(active),
      pointer: pointerRef.current !== null,
      preview: null,
      removing: false,
      step: keyboardStepRef.current,
    });
  };

  /** Where the dragged item lands if released over `over` now. */
  const hintFor = (over: Over, sameList: boolean) =>
    dropHintFor(pointerRef.current, over.rect, keyboardDownRef.current, sameList);

  /**
   * Moves the placeholder to where the item would land. Runs on every move as well as every
   * `over` change, because the target also changes when the pointer crosses a row's midline.
   */
  const syncPreview = (active: Active, over: Over | null) => {
    const state = dragRef.current;
    if (state === null) {
      return;
    }
    // A keyboard drag only moves when an arrow key was pressed; every other collision it sees is
    // the geometry settling around the move it just made.
    if (!state.pointer && state.preview !== null && state.step === keyboardStepRef.current) {
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
    if (to === null) {
      return;
    }
    const sameList = sameContainer(from, to);
    // The container of the list the item already sits in names no other place for it.
    if (sameList && readItemData(over)?.kind === 'groupzone') {
      return;
    }
    const target = resolveDropTarget(currentView, currentSource, over.id, hintFor(over, sameList));
    if (target === null) {
      return;
    }
    // Reveal a collapsed group the moment the placeholder lands in it, so the drop is visible.
    // The expansion and the preview commit together, so the placeholder is never rendered into
    // a group that is still closed. It stays open after the drag.
    if (target.kind === 'group' && collapsedGroupIds.has(target.groupId)) {
      onExpandGroup(target.groupId);
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
      step: keyboardStepRef.current,
      preview: placeholderChannelId === undefined ? next : { ...next, placeholderChannelId },
    });
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    syncPreview(active, over);
  };

  const handleDragMove = ({ active, over }: DragMoveEvent) => {
    const state = dragRef.current;
    const list = listRef.current;
    if (state === null) {
      return;
    }
    if (state.source.kind !== 'available' && list !== null) {
      const pointer = pointerRef.current;
      const removing =
        pointer !== null &&
        pointerOutside(pointer, list.getBoundingClientRect(), REMOVE_DRAG_THRESHOLD_PX);
      if (removing !== state.removing) {
        update({ ...state, removing });
      }
    }
    syncPreview(active, over);
  };

  const finalViewFor = (state: DragState, active: Active, over: Over | null): View | null => {
    if (state.removing) {
      return removalFor(state.startView, state.source);
    }
    if (over === null) {
      return null;
    }
    const currentView = state.preview?.view ?? state.startView;
    const currentSource = state.preview?.source ?? state.source;
    const hint = hintFor(
      over,
      sameContainer(containerOf(currentView, currentSource), containerOfOver(over)),
    );
    if (state.preview !== null) {
      // A keyboard drag settles against whatever collision detection last reported only while
      // that droppable is in the list the arrows already put the row in, where it can only
      // refine the position. A target in another list would undo the move the operator can see:
      // the rows settle after every preview and collision runs again against a stale aim, which
      // is exactly what the root slot above a collapsed group does the moment the group opens.
      const settles =
        state.pointer ||
        sameContainer(containerOf(currentView, currentSource), containerOfOver(over));
      return settles ? settlePreview(state.preview, active.id, over.id, hint) : state.preview.view;
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
    if (state === null) {
      pointerRef.current = null;
      update(null);
      return;
    }
    setDropAnimation(dropAnimationFor(state.source, state.removing));
    update(null);
    // The hint still reads the pointer, so it is cleared after the drop is resolved.
    const finalView = finalViewFor(state, active, over);
    pointerRef.current = null;
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

  // Expanding a group moves everything below it, and `previewFor` may well return the same view.
  const remeasureTrigger = useMemo(
    () => ({ view: drag?.preview?.view, collapsedGroupIds }),
    [drag?.preview?.view, collapsedGroupIds],
  );

  const previewState = useMemo<DragPreviewState>(
    () =>
      drag === null
        ? IDLE_DRAG_PREVIEW
        : {
            dragging: true,
            sourceKind: drag.source.kind,
            source: drag.preview?.source ?? drag.source,
            preview: drag.preview,
            removing: drag.removing,
          },
    [drag],
  );

  const overlay = useMemo(() => {
    if (drag === null) {
      return null;
    }
    const current = drag.preview?.view ?? drag.startView;
    // Same rule as the list: a group without a colour takes its first present member's type.
    const leadKindOf = (groupId: string | undefined): ChannelKind | undefined => {
      if (groupId === undefined) {
        return undefined;
      }
      for (const reference of current.channels) {
        const live = reference.channelId === undefined ? undefined : channels[reference.channelId];
        if (reference.groupId === groupId && live !== undefined) {
          return live.kind;
        }
      }
      return undefined;
    };
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
        const group = current.groups.find((candidate) => candidate.id === reference?.groupId);
        return {
          variant,
          label,
          accent: channelAccent(kind, reference?.color, group, leadKindOf(group?.id)),
          detail: KIND_LABELS[kind],
        };
      }
      case 'group': {
        const groupId = drag.source.groupId;
        const members = current.channels.filter((reference) => reference.groupId === groupId);
        return {
          variant,
          label,
          accent: groupAccent(
            current.groups.find((candidate) => candidate.id === groupId),
            leadKindOf(groupId),
          ),
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
      measuring={VIEW_MEASURING}
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
        <DroppableRemeasure trigger={remeasureTrigger} />
        <DragOverlay dropAnimation={dropAnimation}>
          {overlay === null ? null : <DragOverlayContent {...overlay} />}
        </DragOverlay>
      </DragPreviewContext.Provider>
    </DndContext>
  );
}
