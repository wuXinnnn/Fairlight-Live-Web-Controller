/**
 * jsdom lays nothing out, so every element reports a zero `clientWidth` and the mixer would page
 * one strip at a time. This stub gives the pager viewport (`.mixer-bays`) a controllable size and
 * leaves every other element alone. The default is wide enough for one section header and two
 * channel strips, so a page boundary is easy to reason about in a test.
 *
 * The configuration page has its own stub for `getBoundingClientRect` (`stub-layout.ts`); the two
 * cover different properties and are independent.
 */

import { act } from '@testing-library/react';
import {
  SECTION_HEADER_WIDTH_PX,
  STRIP_GAP_PX,
  STRIP_MIN_HEIGHT_PX,
  STRIP_WIDTH_PX,
} from '../src/features/mixer/page-layout.js';
import { notifyResizeObservers } from './stub-resize-observer.js';

/** One header plus two strips, to the pixel. */
export const STUB_PAGER_WIDTH_PX = SECTION_HEADER_WIDTH_PX + 2 * (STRIP_GAP_PX + STRIP_WIDTH_PX);
/** Taller than a page's minimum height, so the viewport does not scroll by default. */
export const STUB_PAGER_HEIGHT_PX = STRIP_MIN_HEIGHT_PX + 100;

interface PagerSize {
  width: number;
  height: number;
  scrollHeight: number;
}

const sizes = new WeakMap<Element, PagerSize>();

function isPager(element: Element): boolean {
  return element.classList.contains('mixer-bays');
}

function sizeOf(element: Element): PagerSize {
  return (
    sizes.get(element) ?? {
      width: STUB_PAGER_WIDTH_PX,
      height: STUB_PAGER_HEIGHT_PX,
      scrollHeight: STUB_PAGER_HEIGHT_PX,
    }
  );
}

const MEASURES = {
  clientWidth: (size: PagerSize) => size.width,
  clientHeight: (size: PagerSize) => size.height,
  scrollHeight: (size: PagerSize) => size.scrollHeight,
} as const;

/** Installs the stub and returns a function that restores the real getters. */
export function stubMixerLayout(): () => void {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, read] of Object.entries(MEASURES)) {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, name);
    originals.set(name, original);
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      get(this: Element): number {
        if (isPager(this)) {
          return read(sizeOf(this));
        }
        return (original?.get?.call(this) as number | undefined) ?? 0;
      },
    });
  }
  return () => {
    for (const [name, original] of originals) {
      if (original === undefined) {
        Reflect.deleteProperty(Element.prototype, name);
      } else {
        Object.defineProperty(Element.prototype, name, original);
      }
    }
  };
}

/**
 * Resizes the mixer's pager viewport and delivers the resize to whoever is observing it. Pass a
 * `scrollHeight` larger than `height` to put the viewport into the degraded state where the page
 * is taller than the space available and scrolls instead.
 */
export function resizePager(
  width: number,
  height: number = STUB_PAGER_HEIGHT_PX,
  scrollHeight: number = height,
): void {
  const pager = document.querySelector('.mixer-bays');
  if (pager === null) {
    throw new Error('resizePager: the mixer is not rendered');
  }
  sizes.set(pager, { width, height, scrollHeight });
  act(() => {
    notifyResizeObservers(pager, width, height);
  });
}
