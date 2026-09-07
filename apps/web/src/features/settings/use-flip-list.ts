import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

/** Movements smaller than this, in CSS pixels, are not animated. */
export const FLIP_MIN_SHIFT_PX = 1;

/** Transition applied while a row slides into its new place. */
export const FLIP_TRANSITION = 'transform var(--motion-medium) ease-out';

/** Removes the inline styles even when `transitionend` never fires (e.g. a hidden tab). */
export const FLIP_CLEANUP_FALLBACK_MS = 600;

const FLIP_SELECTOR = '[data-flip-key]';

export interface FlipListHandle {
  /** Re-measures now, so the next commit animates from the current visual positions. */
  capture(): void;
  /** Measures but does not animate on the next commit. */
  skipNext(): void;
}

interface Shift {
  dx: number;
  dy: number;
}

function flipKey(element: Element): string {
  return element.getAttribute('data-flip-key') ?? '';
}

function measure(container: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const element of container.querySelectorAll(FLIP_SELECTOR)) {
    rects.set(flipKey(element), element.getBoundingClientRect());
  }
  return rects;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/**
 * FLIP animation for a list: after every commit the elements carrying `data-flip-key` are
 * measured, and any element that moved by more than `FLIP_MIN_SHIFT_PX` first receives the
 * inverse translation and then transitions back to its natural place. Rows nested inside a
 * moved block only animate their movement relative to that block. Elements that were not in the
 * previous measurement (newly added rows) are left alone, and reduced-motion users get no
 * animation at all.
 */
export function useFlipList<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  dependency: unknown,
): FlipListHandle {
  const lastRects = useRef(new Map<string, DOMRect>());
  const skipNext = useRef(false);
  const pending = useRef(new Map<HTMLElement, () => void>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      lastRects.current = new Map();
      return;
    }
    const previous = lastRects.current;
    const next = measure(container);
    lastRects.current = next;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (previous.size === 0 || prefersReducedMotion()) {
      return;
    }
    const shifts = new Map<Element, Shift>();
    for (const element of container.querySelectorAll(FLIP_SELECTOR)) {
      const before = previous.get(flipKey(element));
      const after = next.get(flipKey(element));
      if (before !== undefined && after !== undefined) {
        shifts.set(element, { dx: before.left - after.left, dy: before.top - after.top });
      }
    }
    for (const [element, shift] of shifts) {
      const parent = element.parentElement?.closest(FLIP_SELECTOR);
      const parentShift = parent === null || parent === undefined ? undefined : shifts.get(parent);
      const dx = shift.dx - (parentShift?.dx ?? 0);
      const dy = shift.dy - (parentShift?.dy ?? 0);
      if (Math.abs(dx) < FLIP_MIN_SHIFT_PX && Math.abs(dy) < FLIP_MIN_SHIFT_PX) {
        continue;
      }
      if (element instanceof HTMLElement) {
        animate(element, dx, dy, pending.current);
      }
    }
  }, [containerRef, dependency]);

  useEffect(() => {
    const active = pending.current;
    return () => {
      for (const cleanup of [...active.values()]) {
        cleanup();
      }
    };
  }, []);

  return useMemo(
    () => ({
      capture: () => {
        const container = containerRef.current;
        lastRects.current = container === null ? new Map() : measure(container);
      },
      skipNext: () => {
        skipNext.current = true;
      },
    }),
    [containerRef],
  );
}

function animate(
  element: HTMLElement,
  dx: number,
  dy: number,
  pending: Map<HTMLElement, () => void>,
): void {
  pending.get(element)?.();
  element.style.transition = 'none';
  element.style.transform = `translate(${dx}px, ${dy}px)`;
  // Force a style flush so the inverse transform is painted before the transition starts.
  void element.getBoundingClientRect();
  const frame = requestAnimationFrame(() => {
    element.style.transition = FLIP_TRANSITION;
    element.style.transform = '';
  });
  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === element && event.propertyName === 'transform') {
      cleanup();
    }
  };
  const timer = setTimeout(() => cleanup(), FLIP_CLEANUP_FALLBACK_MS);
  const cleanup = (): void => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    element.removeEventListener('transitionend', onTransitionEnd);
    element.style.transition = '';
    element.style.transform = '';
    pending.delete(element);
  };
  element.addEventListener('transitionend', onTransitionEnd);
  pending.set(element, cleanup);
}
