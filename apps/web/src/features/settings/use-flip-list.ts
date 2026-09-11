import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { naturalGeometry, type NaturalRect, type Translate } from './flip-geometry.js';

/** Movements smaller than this, in CSS pixels, are not animated. */
export const FLIP_MIN_SHIFT_PX = 1;

/**
 * How long, in milliseconds, a row takes to slide into its new place. It is short on purpose:
 * the same tween now runs while a drag previews its drop, so it has to keep up with the pointer.
 */
export const FLIP_DURATION_MS = 120;

/** Transition applied while a row slides into its new place. */
export const FLIP_TRANSITION = `transform ${FLIP_DURATION_MS}ms ease-out`;

/** Removes the inline styles even when `transitionend` never fires (e.g. a hidden tab). */
export const FLIP_CLEANUP_FALLBACK_MS = FLIP_DURATION_MS * 3;

const FLIP_SELECTOR = '[data-flip-key]';
/** Rows that must follow the drag instead of trailing it: the dragged row and its placeholder. */
const FLIP_SKIP_SELECTOR = '[data-flip-skip]';

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

/**
 * One element as of a commit: where it belongs in the layout, and the translate it happens to be
 * carrying right now. Both are read in the same pass, before any cleanup can wipe a transform.
 */
interface Measured {
  rect: NaturalRect;
  own: Translate;
}

/** Distinguishable from every dependency value, so the first commit only takes a baseline. */
const NOT_MEASURED = Symbol('flip-not-measured');

function flipKey(element: Element): string {
  return element.getAttribute('data-flip-key') ?? '';
}

function measure(container: HTMLElement): Map<string, Measured> {
  const measured = new Map<string, Measured>();
  for (const element of container.querySelectorAll(FLIP_SELECTOR)) {
    measured.set(flipKey(element), naturalGeometry(element));
  }
  return measured;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/**
 * FLIP animation for a list: the elements carrying `data-flip-key` are measured after **every**
 * commit, so the baseline always describes what is on screen, but only a commit that changed
 * `dependency` animates. Rows nested inside a moved block only animate their movement relative to
 * that block. Elements that were not in the previous measurement (newly added rows) and elements
 * marked `data-flip-skip` are left alone, and reduced-motion users get no animation at all.
 *
 * Measuring on every commit matters because rows also move for reasons the dependency does not
 * describe (a duplicate-name flag appearing, the inventory resolving); animating only on the
 * dependency keeps those from being mistaken for a reorder.
 *
 * Positions are **natural** ones — `getBoundingClientRect` minus the translate in effect — so a
 * tween that is still running does not read as a layout change. That gives two properties a
 * fast drag depends on. An element whose natural position did not move is left completely alone,
 * so its tween keeps running at its own pace instead of being restarted from a place it is not
 * in. An element that is pushed again mid-tween starts its new tween from where it currently
 * looks, by keeping the translate it already carries, so it never jumps back first.
 */
export function useFlipList<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  dependency: unknown,
): FlipListHandle {
  const lastMeasured = useRef(new Map<string, Measured>());
  const lastDependency = useRef<unknown>(NOT_MEASURED);
  const skipNext = useRef(false);
  const pending = useRef(new Map<HTMLElement, () => void>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      lastMeasured.current = new Map();
      return;
    }
    const previous = lastMeasured.current;
    // Everything is read up front: `animate` clears the transform of the element it restarts,
    // so a translate read inside the loop below would already be gone for earlier elements.
    const next = measure(container);
    lastMeasured.current = next;
    const changed = !Object.is(lastDependency.current, dependency);
    lastDependency.current = dependency;
    if (!changed) {
      return;
    }
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (previous.size === 0 || prefersReducedMotion()) {
      return;
    }
    // How far each element's natural place moved, as an inverse translation.
    const shifts = new Map<Element, Shift>();
    for (const element of container.querySelectorAll(FLIP_SELECTOR)) {
      const before = previous.get(flipKey(element));
      const after = next.get(flipKey(element));
      if (before !== undefined && after !== undefined) {
        shifts.set(element, {
          dx: before.rect.left - after.rect.left,
          dy: before.rect.top - after.rect.top,
        });
      }
    }
    for (const [element, shift] of shifts) {
      const parent = element.parentElement?.closest(FLIP_SELECTOR);
      const parentShift = parent === null || parent === undefined ? undefined : shifts.get(parent);
      const dx = shift.dx - (parentShift?.dx ?? 0);
      const dy = shift.dy - (parentShift?.dy ?? 0);
      // The natural place did not move: whatever tween is running is still heading somewhere
      // correct, so touching this element could only interrupt it.
      if (Math.abs(dx) < FLIP_MIN_SHIFT_PX && Math.abs(dy) < FLIP_MIN_SHIFT_PX) {
        continue;
      }
      if (element instanceof HTMLElement && !element.matches(FLIP_SKIP_SELECTOR)) {
        // Start from where the element currently looks, not from its natural place. Only its own
        // translate counts: an ancestor's is already covered by subtracting the parent's shift.
        const own = next.get(flipKey(element))?.own ?? { x: 0, y: 0 };
        animate(element, dx + own.x, dy + own.y, pending.current);
      }
    }
  });

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
        lastMeasured.current = container === null ? new Map() : measure(container);
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
