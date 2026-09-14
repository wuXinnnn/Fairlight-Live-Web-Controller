import { afterEach, describe, expect, it, vi } from 'vitest';
import { WheelGestures, type WheelEventData } from 'wheel-gestures';
import {
  INITIAL_PAGE_WHEEL_STATE,
  PAGE_WHEEL_THRESHOLD_PX,
  reducePageWheel,
  type PageWheelState,
} from './page-wheel.js';
import { pagingDelta } from './wheel-delta.js';

/**
 * The pager reads the wheel through wheel-gestures, so the thresholds only behave as intended if
 * the two are exercised together. These are shaped like the event streams a precision trackpad
 * produces — a ramp while the finger pushes, a decay once it lets go — rather than recordings
 * from one machine, so what they lock down is the arithmetic, not any particular pad. The feel on
 * real hardware is still the operator's call.
 */

interface Wheel {
  ms: number;
  x?: number;
  y: number;
}

function eventsFrom(wheel: Wheel[]): WheelEventData[] {
  return wheel.map(({ ms, x = 0, y }) => ({
    deltaMode: 0,
    deltaX: x,
    deltaY: y,
    timeStamp: ms,
  }));
}

/** Runs a stream through the detector and the reducer the way the pager wires them together. */
function turnsFor(wheel: Wheel[], shiftKey = false) {
  const gestures = WheelGestures({ preventWheelAction: false, reverseSign: false });
  let state: PageWheelState = INITIAL_PAGE_WHEEL_STATE;
  const turns: number[] = [];
  let momentumSeen = false;

  gestures.on('wheel', (reading) => {
    if (reading.isEnding) {
      return;
    }
    momentumSeen ||= reading.isMomentum;
    const result = reducePageWheel(state, {
      delta: pagingDelta({ x: reading.axisDelta[0], y: reading.axisDelta[1] }, shiftKey),
      now: reading.event.timeStamp,
      momentum: reading.isMomentum,
    });
    state = result.state;
    if (result.page !== 0) {
      turns.push(result.page);
    }
  });

  gestures.feedWheel(eventsFrom(wheel));
  return { turns, momentumSeen };
}

/** A push that speeds up and holds, then lets go and coasts to nothing. */
function flick({ from = 0, peak = 80, hold = 3, decay = 0.94 } = {}): Wheel[] {
  const wheel: Wheel[] = [];
  let ms = from;
  for (const y of [6, 14, 26, 42, 60, peak]) {
    wheel.push({ ms, y });
    ms += 10;
  }
  for (let i = 0; i < hold; i += 1) {
    wheel.push({ ms, y: peak });
    ms += 10;
  }
  for (let y = peak * decay; y > 0.4; y *= decay) {
    wheel.push({ ms, y: Math.round(y * 100) / 100 });
    ms += 12;
  }
  return wheel;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the pager reading a trackpad', () => {
  it('turns one page for one flick, however far it coasts', () => {
    vi.useFakeTimers();
    const wheel = flick();
    // The coast alone is worth about ten pages; letting it spend that is the whole problem.
    const coastTravel = wheel.slice(9).reduce((sum, event) => sum + event.y, 0);
    expect(coastTravel).toBeGreaterThan(10 * PAGE_WHEEL_THRESHOLD_PX);

    const { turns, momentumSeen } = turnsFor(wheel);

    expect(momentumSeen).toBe(true);
    expect(turns).toEqual([1]);
  });

  it('keeps turning while the finger keeps pushing', () => {
    vi.useFakeTimers();
    // No let-up and no decay: the operator is dragging, not throwing.
    const wheel = Array.from({ length: 90 }, (_, i) => ({
      ms: i * 12,
      y: 18 + (i % 3) - 1,
    }));

    const { turns, momentumSeen } = turnsFor(wheel);

    expect(momentumSeen).toBe(false);
    expect(turns.length).toBeGreaterThan(2);
    expect(turns.every((page) => page === 1)).toBe(true);
  });

  it('turns a page per flick when the operator flicks again', () => {
    vi.useFakeTimers();
    const wheel = [...flick(), ...flick({ from: 1400 })];

    expect(turnsFor(wheel).turns).toEqual([1, 1]);
  });

  it('ignores the sideways wander of a swipe that means to go up', () => {
    vi.useFakeTimers();
    // Frames where the finger has not yet moved a whole pixel down still report the wander of
    // the hand across the pad. Counting those turned a swipe up into a page down.
    const wheel: Wheel[] = [];
    for (let i = 0; i < 40; i += 1) {
      wheel.push(i % 3 === 0 ? { ms: i * 12, x: 9, y: 0 } : { ms: i * 12, x: 3, y: -4 });
    }

    const { turns } = turnsFor(wheel);

    expect(turns.every((page) => page === -1)).toBe(true);
    expect(turns.length).toBeGreaterThan(0);
  });
});
