import { describe, expect, it } from 'vitest';
import {
  normalizeWheelDelta,
  pagingDelta,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_PAGE_HEIGHT_PX,
} from './wheel-delta.js';

describe('normalizeWheelDelta', () => {
  it('leaves pixel deltas alone', () => {
    expect(normalizeWheelDelta({ deltaX: -4, deltaY: 100, deltaMode: 0 })).toEqual({
      x: -4,
      y: 100,
    });
  });

  it('scales line and page deltas to pixels', () => {
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({
      x: 0,
      y: 3 * WHEEL_LINE_HEIGHT_PX,
    });
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: -1, deltaMode: 2 })).toEqual({
      x: 0,
      y: -WHEEL_PAGE_HEIGHT_PX,
    });
  });
});

describe('pagingDelta', () => {
  it('reads the vertical axis', () => {
    expect(pagingDelta({ x: 0, y: 100 }, false)).toBe(100);
  });

  it('reads the horizontal axis Shift moves the wheel onto', () => {
    expect(pagingDelta({ x: -100, y: 0 }, true)).toBe(-100);
  });

  it('prefers the vertical axis when both are moving, Shift or not', () => {
    expect(pagingDelta({ x: 80, y: -20 }, false)).toBe(-20);
    expect(pagingDelta({ x: 80, y: -20 }, true)).toBe(-20);
  });

  it('ignores sideways travel without Shift', () => {
    // A two-finger swipe reports its sideways wander here in frames where the vertical travel
    // has not yet rounded up to a pixel. Reading it turns a swipe into a page turn the other way.
    expect(pagingDelta({ x: 14, y: 0 }, false)).toBe(0);
    expect(pagingDelta({ x: -90, y: 0 }, false)).toBe(0);
  });

  it('is zero when nothing moves', () => {
    expect(pagingDelta({ x: 0, y: 0 }, false)).toBe(0);
  });
});
