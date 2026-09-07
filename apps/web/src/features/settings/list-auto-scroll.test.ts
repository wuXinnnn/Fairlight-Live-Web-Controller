import { describe, expect, it } from 'vitest';
import { scrollStepFor } from './list-auto-scroll.js';

const box = { top: 100, bottom: 500 };

describe('scrollStepFor', () => {
  it('scrolls up near the top edge and down near the bottom edge, faster closer to the edge', () => {
    expect(scrollStepFor(100, box, 48, 12)).toBe(-12);
    expect(scrollStepFor(124, box, 48, 12)).toBeCloseTo(-6);
    expect(scrollStepFor(148, box, 48, 12)).toBe(0);
    expect(scrollStepFor(500, box, 48, 12)).toBe(12);
    expect(scrollStepFor(476, box, 48, 12)).toBeCloseTo(6);
    expect(scrollStepFor(452, box, 48, 12)).toBe(0);
  });

  it('keeps full speed just outside the edge and stops further away', () => {
    expect(scrollStepFor(60, box, 48, 12)).toBe(-12);
    expect(scrollStepFor(52, box, 48, 12)).toBe(0);
    expect(scrollStepFor(540, box, 48, 12)).toBe(12);
    expect(scrollStepFor(548, box, 48, 12)).toBe(0);
  });

  it('does nothing in the middle, for degenerate inputs or a container shorter than both zones', () => {
    expect(scrollStepFor(300, box, 48, 12)).toBe(0);
    expect(scrollStepFor(100, box, 0, 12)).toBe(0);
    expect(scrollStepFor(100, box, 48, 0)).toBe(0);
    expect(scrollStepFor(110, { top: 100, bottom: 180 }, 48, 12)).toBe(0);
  });
});
