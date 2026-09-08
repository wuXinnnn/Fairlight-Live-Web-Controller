import { useDndContext, useDndMonitor } from '@dnd-kit/core';
import { useEffect, useRef, type RefObject } from 'react';
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP_PX,
  AUTO_SCROLL_REMEASURE_MS,
} from './dnd-config.js';
import type { Point } from './drag-preview.js';
import { scrollStepFor } from './list-auto-scroll.js';

interface ListAutoScrollerProps {
  listRef: RefObject<HTMLElement | null>;
  /** Latest pointer position of the drag; null for keyboard drags. */
  pointerRef: RefObject<Point | null>;
}

export interface Scroller {
  /** Starts the frame loop; each frame reads the pointer and scrolls when it is near an edge. */
  start(): void;
  stop(): void;
}

export function createScroller(
  listRef: RefObject<HTMLElement | null>,
  pointerRef: RefObject<Point | null>,
  remeasure: RefObject<() => void>,
  viewportHeight: () => number = () => window.innerHeight,
): Scroller {
  let frame: number | null = null;
  let lastMeasure = Number.NEGATIVE_INFINITY;
  const stop = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
  const tick = (): void => {
    const list = listRef.current;
    const pointer = pointerRef.current;
    if (list === null) {
      stop();
      return;
    }
    if (pointer !== null) {
      // Only the visible part of the list counts: on a phone its bottom edge is often below the
      // viewport, and the pointer can only ever rest at the edge that is on screen.
      const box = list.getBoundingClientRect();
      const visible = { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, viewportHeight()) };
      const step = scrollStepFor(pointer.y, visible, AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_STEP_PX);
      const before = list.scrollTop;
      if (step !== 0) {
        list.scrollTop = before + step;
      }
      if (list.scrollTop !== before) {
        const now = performance.now();
        if (now - lastMeasure >= AUTO_SCROLL_REMEASURE_MS) {
          lastMeasure = now;
          remeasure.current();
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };
  return {
    start() {
      if (frame === null) {
        lastMeasure = Number.NEGATIVE_INFINITY;
        frame = requestAnimationFrame(tick);
      }
    },
    stop,
  };
}

/**
 * Scrolls the CHANNEL ORDER list while a pointer drag rests near its top or bottom edge, and
 * re-measures the droppables as it goes so drop targets keep matching what is on screen. Only
 * this list scrolls: dnd-kit's own auto-scroll is disabled because it follows the dragged
 * node's ancestors, which is the AVAILABLE list for a channel dragged from there. The pointer is
 * tracked directly because dnd-kit's drag deltas already include the list's scroll offset.
 */
export function ListAutoScroller({ listRef, pointerRef }: ListAutoScrollerProps) {
  const { measureDroppableContainers } = useDndContext();
  const remeasure = useRef<() => void>(() => undefined);
  useEffect(() => {
    remeasure.current = () => measureDroppableContainers([]);
  }, [measureDroppableContainers]);
  const scrollerRef = useRef<Scroller | null>(null);
  useEffect(() => {
    const scroller = createScroller(listRef, pointerRef, remeasure);
    scrollerRef.current = scroller;
    return () => {
      scroller.stop();
      scrollerRef.current = null;
    };
  }, [listRef, pointerRef]);

  useDndMonitor({
    onDragStart: () => scrollerRef.current?.start(),
    onDragEnd: () => scrollerRef.current?.stop(),
    onDragCancel: () => scrollerRef.current?.stop(),
  });

  return null;
}
