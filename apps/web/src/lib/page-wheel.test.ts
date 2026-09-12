import { describe, expect, it } from 'vitest';
import {
  INITIAL_PAGE_WHEEL_STATE,
  PAGE_WHEEL_COOLDOWN_MS,
  PAGE_WHEEL_QUIET_MS,
  reducePageWheel,
  type PageWheelState,
} from './page-wheel.js';

describe('reducePageWheel', () => {
  it('turns exactly one page per mouse notch and swallows the next one', () => {
    const first = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 });
    expect(first.page).toBe(1);
    expect(first.state.triggeredAt).toBe(0);

    // A second notch a moment later is still the same gesture as far as the wheel is concerned.
    const second = reducePageWheel(first.state, { delta: 100, now: 60 });
    expect(second.page).toBe(0);
  });

  it('turns one page for a whole trackpad flick', () => {
    let state: PageWheelState = INITIAL_PAGE_WHEEL_STATE;
    let turns = 0;
    for (let event = 0; event < 30; event += 1) {
      // A flick decays: large deltas first, trailing off as the inertia runs out.
      const result = reducePageWheel(state, { delta: 30 - event, now: event * 12 });
      state = result.state;
      turns += result.page;
    }

    expect(turns).toBe(1);
  });

  it('goes back a page when the wheel goes up', () => {
    expect(reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: -100, now: 0 }).page).toBe(-1);
  });

  it('needs both silence and a settled page before it counts again', () => {
    const turned = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 }).state;

    // Still coasting: the wheel has not been quiet, however long it is since the turn.
    const coasting = reducePageWheel(turned, { delta: 100, now: 100 });
    expect(coasting.page).toBe(0);

    // Quiet for long enough now, but the page that turned at 0 has not settled yet.
    const tooSoon = reducePageWheel(coasting.state, { delta: 100, now: 100 + PAGE_WHEEL_QUIET_MS });
    expect(tooSoon.page).toBe(0);
    expect(100 + PAGE_WHEEL_QUIET_MS).toBeLessThan(PAGE_WHEEL_COOLDOWN_MS);

    const allowed = reducePageWheel(tooSoon.state, {
      delta: 100,
      now: 100 + PAGE_WHEEL_QUIET_MS + PAGE_WHEEL_QUIET_MS,
    });
    expect(allowed.page).toBe(1);
  });

  it('turns the other way once the wheel has been still', () => {
    const turned = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 }).state;
    const next = reducePageWheel(turned, { delta: -100, now: 1000 });

    expect(next.page).toBe(-1);
  });

  it('throws the accumulation away when the wheel turns around mid-count', () => {
    const down = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 40, now: 0 });
    expect(down.page).toBe(0);

    const up = reducePageWheel(down.state, { delta: -40, now: 10 });
    expect(up.page).toBe(0);
    expect(up.state.accumulated).toBe(40);
    expect(up.state.direction).toBe(-1);
  });

  it('only notes the time for an event that does not move', () => {
    const still = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 0, now: 25 });

    expect(still.page).toBe(0);
    expect(still.state).toEqual({ ...INITIAL_PAGE_WHEEL_STATE, lastEventAt: 25 });
  });
});
