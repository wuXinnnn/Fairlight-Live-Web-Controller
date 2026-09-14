/**
 * Turns wheel movement into page turns. The aim is that one mouse notch and one flick of a
 * trackpad each move exactly one page: the first is a single large event, the second a burst of
 * dozens of small ones, and both have to mean the same thing. A finger that keeps going, though,
 * has to keep turning pages — a page turn is not a gesture you can only make once.
 */

/** Accumulated travel that turns the first page of a gesture. */
export const PAGE_WHEEL_THRESHOLD_PX = 60;
/**
 * Accumulated travel that turns another one while the same gesture is still running. It is the
 * higher of the two so that the tail of a flick, which is travel the operator did not ask for,
 * runs out before it reaches a second page.
 */
export const PAGE_WHEEL_REPEAT_THRESHOLD_PX = 120;
/** Silence that ends a gesture, after which the next page costs the lower threshold again. */
export const PAGE_WHEEL_QUIET_MS = 150;
/**
 * Time that has to pass since the last page turn before another one is allowed. It sits just
 * under the length of the slide, so a page keeps moving into the next one rather than stopping
 * between the two.
 */
export const PAGE_WHEEL_COOLDOWN_MS = 180;

export interface PageWheelState {
  accumulated: number;
  direction: -1 | 0 | 1;
  lastEventAt: number;
  /** When the last page turn happened, or null when not cooling down. */
  triggeredAt: number | null;
  /** A page has already turned in this gesture and the wheel has not been quiet since. */
  sustained: boolean;
}

export const INITIAL_PAGE_WHEEL_STATE: PageWheelState = {
  accumulated: 0,
  direction: 0,
  lastEventAt: 0,
  triggeredAt: null,
  sustained: false,
};

/**
 * Scrolling down (a positive delta) moves to the next page. Once a page turns the reducer swallows
 * everything until the page has all but landed, and banks none of it: the tail of a trackpad flick
 * is worth several thresholds and would otherwise fly through the whole desk. Counting then starts
 * again from nothing — at the higher threshold while the gesture is still running, at the lower
 * one once the wheel has been quiet long enough to call it a new one.
 *
 * `momentum` says the travel is the operating system coasting rather than a finger still on the
 * pad. Coasting may finish the page it was thrown at but may never ask for another one, however
 * far it runs: an operator flicks once and means one page. A finger that keeps pushing is not
 * momentum and keeps its say.
 */
export function reducePageWheel(
  state: PageWheelState,
  input: { delta: number; now: number; momentum?: boolean },
): { state: PageWheelState; page: -1 | 0 | 1 } {
  const { delta, now, momentum = false } = input;
  if (momentum && (state.triggeredAt !== null || state.sustained)) {
    // The throw has already been answered. Bank none of the coast, or the moment the cooldown
    // ends there is a threshold's worth of travel waiting to spend on a page nobody asked for.
    return { state: { ...state, accumulated: 0, lastEventAt: now }, page: 0 };
  }
  const quiet = now - state.lastEventAt >= PAGE_WHEEL_QUIET_MS;
  let counting = state;

  if (counting.triggeredAt !== null) {
    if (now - counting.triggeredAt < PAGE_WHEEL_COOLDOWN_MS) {
      return { state: { ...counting, accumulated: 0, lastEventAt: now }, page: 0 };
    }
    counting = {
      accumulated: 0,
      direction: 0,
      lastEventAt: now,
      triggeredAt: null,
      sustained: !quiet,
    };
  } else if (quiet) {
    counting = { ...counting, sustained: false };
  }

  if (delta === 0) {
    return { state: { ...counting, lastEventAt: now }, page: 0 };
  }
  const direction = delta > 0 ? 1 : -1;
  const accumulated =
    (counting.direction === direction ? counting.accumulated : 0) + Math.abs(delta);
  const threshold = counting.sustained ? PAGE_WHEEL_REPEAT_THRESHOLD_PX : PAGE_WHEEL_THRESHOLD_PX;
  if (accumulated < threshold) {
    return {
      state: { ...counting, accumulated, direction, lastEventAt: now, triggeredAt: null },
      page: 0,
    };
  }
  return {
    state: {
      accumulated: 0,
      direction,
      lastEventAt: now,
      triggeredAt: now,
      sustained: counting.sustained,
    },
    page: direction,
  };
}
