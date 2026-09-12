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
  it('reads the vertical axis when that is the one moving', () => {
    expect(pagingDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(100);
  });

  it('reads the horizontal axis Shift moves the wheel onto', () => {
    expect(pagingDelta({ deltaX: -100, deltaY: 0, deltaMode: 0 })).toBe(-100);
    expect(pagingDelta({ deltaX: 3, deltaY: 0, deltaMode: 1 })).toBe(3 * WHEEL_LINE_HEIGHT_PX);
  });

  it('prefers the vertical axis when both are moving', () => {
    expect(pagingDelta({ deltaX: 80, deltaY: -20, deltaMode: 0 })).toBe(-20);
  });

  it('is zero when nothing moves', () => {
    expect(pagingDelta({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toBe(0);
  });
});
