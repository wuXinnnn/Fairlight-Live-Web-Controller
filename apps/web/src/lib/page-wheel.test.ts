import { describe, expect, it } from 'vitest';
import {
  INITIAL_PAGE_WHEEL_STATE,
  PAGE_WHEEL_COOLDOWN_MS,
  PAGE_WHEEL_QUIET_MS,
  PAGE_WHEEL_REPEAT_THRESHOLD_PX,
  PAGE_WHEEL_THRESHOLD_PX,
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

  it('keeps turning while the finger keeps going', () => {
    let state: PageWheelState = INITIAL_PAGE_WHEEL_STATE;
    let turns = 0;
    // A finger dragged across the trackpad: a steady stream of small events, no let-up.
    for (let event = 0; event < 80; event += 1) {
      const result = reducePageWheel(state, { delta: 12, now: event * 12 });
      state = result.state;
      turns += result.page;
    }

    expect(turns).toBeGreaterThan(1);
  });

  it('goes back a page when the wheel goes up', () => {
    expect(reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: -100, now: 0 }).page).toBe(-1);
  });

  it('waits for the page to land, and banks nothing while it does', () => {
    const turned = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 }).state;

    const coasting = reducePageWheel(turned, { delta: 1000, now: PAGE_WHEEL_COOLDOWN_MS - 1 });
    expect(coasting.page).toBe(0);
    // None of that thousand pixels is held over to be spent the moment the page lands.
    expect(coasting.state.accumulated).toBe(0);

    const landed = reducePageWheel(coasting.state, { delta: 30, now: PAGE_WHEEL_COOLDOWN_MS });
    expect(landed.page).toBe(0);
    expect(landed.state.accumulated).toBe(30);
  });

  it('charges more for the next page while the gesture is still running', () => {
    let state = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 }).state;
    // The finger is still going: an event lands while the page is still on its way.
    state = reducePageWheel(state, { delta: 100, now: PAGE_WHEEL_COOLDOWN_MS / 2 }).state;
    let now = PAGE_WHEEL_COOLDOWN_MS;

    // The wheel never went quiet, so the base threshold is not enough for a second page.
    const short = reducePageWheel(state, { delta: PAGE_WHEEL_THRESHOLD_PX, now });
    expect(short.page).toBe(0);

    state = short.state;
    now += 10;
    const rest = PAGE_WHEEL_REPEAT_THRESHOLD_PX - PAGE_WHEEL_THRESHOLD_PX;
    expect(reducePageWheel(state, { delta: rest, now }).page).toBe(1);
  });

  it('goes back to the base threshold once the wheel has been quiet', () => {
    const turned = reducePageWheel(INITIAL_PAGE_WHEEL_STATE, { delta: 100, now: 0 }).state;
    const now = PAGE_WHEEL_COOLDOWN_MS + PAGE_WHEEL_QUIET_MS;

    expect(reducePageWheel(turned, { delta: PAGE_WHEEL_THRESHOLD_PX, now }).page).toBe(1);
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
