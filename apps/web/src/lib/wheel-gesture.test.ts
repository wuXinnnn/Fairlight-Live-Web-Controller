import { describe, expect, it, vi } from 'vitest';
import {
  createWheelGestureTracker,
  currentOwner,
  sameOwner,
  WHEEL_GESTURE_IDLE_MS,
  type GestureClock,
} from './wheel-gesture.js';

/** A clock the test drives by hand, so no gesture ever waits on real time. */
function testClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextHandle = 1;
  const clock: GestureClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(handle);
        timer.fn();
      }
    }
  };
  return { clock, advance };
}

describe('gesture ownership', () => {
  it('compares owners by what they are, not by identity', () => {
    expect(sameOwner('page', 'page')).toBe(true);
    expect(sameOwner({ fader: 'channel/1' }, { fader: 'channel/1' })).toBe(true);
    expect(sameOwner({ fader: 'channel/1' }, { fader: 'channel/2' })).toBe(false);
    expect(sameOwner('page', { fader: 'channel/1' })).toBe(false);
    expect(sameOwner(null, null)).toBe(true);
    expect(sameOwner(null, 'page')).toBe(false);
  });

  it('has no owner once the gesture has been quiet', () => {
    const state = { owner: 'page' as const, lastEventAt: 0 };

    expect(currentOwner(state, WHEEL_GESTURE_IDLE_MS - 1)).toBe('page');
    expect(currentOwner(state, WHEEL_GESTURE_IDLE_MS)).toBeNull();
  });
});

describe('createWheelGestureTracker', () => {
  it('never displaces the owner of a gesture in progress', () => {
    const { clock, advance } = testClock();
    const tracker = createWheelGestureTracker(clock);
    const onEnd = vi.fn();
    const other = vi.fn();

    expect(tracker.begin({ fader: 'channel/1' }, onEnd)).toEqual({ fader: 'channel/1' });
    advance(20);
    expect(tracker.begin('page', other)).toEqual({ fader: 'channel/1' });
    expect(other).not.toHaveBeenCalled();
  });

  it('ends a gesture once, after the wheel has been quiet', () => {
    const { clock, advance } = testClock();
    const tracker = createWheelGestureTracker(clock);
    const onEnd = vi.fn();

    tracker.begin({ fader: 'channel/1' }, onEnd);
    // Every event pushes the end further out, so a long gesture never ends mid-scroll.
    for (let event = 0; event < 10; event += 1) {
      advance(WHEEL_GESTURE_IDLE_MS - 20);
      tracker.touch();
      expect(onEnd).not.toHaveBeenCalled();
    }

    advance(WHEEL_GESTURE_IDLE_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(tracker.owner()).toBeNull();

    advance(WHEEL_GESTURE_IDLE_MS * 4);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('lets the next gesture claim the wheel once the last one ended', () => {
    const { clock, advance } = testClock();
    const tracker = createWheelGestureTracker(clock);
    const first = vi.fn();
    const second = vi.fn();

    tracker.begin({ fader: 'channel/1' }, first);
    advance(WHEEL_GESTURE_IDLE_MS);
    expect(first).toHaveBeenCalledTimes(1);

    expect(tracker.begin('page', second)).toBe('page');
    expect(tracker.owner()).toBe('page');
    advance(WHEEL_GESTURE_IDLE_MS);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('closes out an expired gesture that its own timer has not reached yet', () => {
    const { clock } = testClock();
    const tracker = createWheelGestureTracker(clock);
    const first = vi.fn();

    tracker.begin({ fader: 'channel/1' }, first);
    // No timer has run, but enough time has passed that the gesture is over.
    clock.now = () => WHEEL_GESTURE_IDLE_MS;

    expect(tracker.begin('page', vi.fn())).toBe('page');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('ignores a touch when nobody owns the wheel, and drops a gesture on reset', () => {
    const { clock, advance } = testClock();
    const tracker = createWheelGestureTracker(clock);
    const onEnd = vi.fn();

    tracker.touch();
    expect(tracker.owner()).toBeNull();

    tracker.begin('page', onEnd);
    tracker.reset();
    expect(tracker.owner()).toBeNull();
    advance(WHEEL_GESTURE_IDLE_MS * 2);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
