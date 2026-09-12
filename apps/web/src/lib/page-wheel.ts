/**
 * Turns wheel movement into page turns. The aim is that one mouse notch and one flick of a
 * trackpad each move exactly one page: the first is a single large event, the second a burst of
 * dozens of small ones, and both have to mean the same thing.
 */

/** Accumulated travel that turns a page. */
export const PAGE_WHEEL_THRESHOLD_PX = 60;
/** Silence that has to pass before a new gesture can begin. */
export const PAGE_WHEEL_QUIET_MS = 150;
/** Time that has to pass since the last page turn before another one is allowed. */
export const PAGE_WHEEL_COOLDOWN_MS = 300;

export interface PageWheelState {
  accumulated: number;
  direction: -1 | 0 | 1;
  lastEventAt: number;
  /** When the last page turn happened, or null when not cooling down. */
  triggeredAt: number | null;
}

export const INITIAL_PAGE_WHEEL_STATE: PageWheelState = {
  accumulated: 0,
  direction: 0,
  lastEventAt: 0,
  triggeredAt: null,
};

/**
 * Scrolling down (a positive delta) moves to the next page. Once a page turns the reducer stops
 * counting and swallows whatever is left of the gesture: the tail of a trackpad flick is worth
 * several thresholds and would otherwise fly through the whole desk. Counting resumes only when
 * the wheel has been quiet long enough to be a new gesture *and* enough time has passed since
 * the turn for the page to have settled.
 */
export function reducePageWheel(
  state: PageWheelState,
  input: { delta: number; now: number },
): { state: PageWheelState; page: -1 | 0 | 1 } {
  const { delta, now } = input;
  let counting = state;

  if (counting.triggeredAt !== null) {
    const quiet = now - counting.lastEventAt >= PAGE_WHEEL_QUIET_MS;
    const settled = now - counting.triggeredAt >= PAGE_WHEEL_COOLDOWN_MS;
    if (!quiet || !settled) {
      return { state: { ...counting, lastEventAt: now }, page: 0 };
    }
    counting = { accumulated: 0, direction: 0, lastEventAt: now, triggeredAt: null };
  }

  if (delta === 0) {
    return { state: { ...counting, lastEventAt: now }, page: 0 };
  }
  const direction = delta > 0 ? 1 : -1;
  const accumulated =
    (counting.direction === direction ? counting.accumulated : 0) + Math.abs(delta);
  if (accumulated < PAGE_WHEEL_THRESHOLD_PX) {
    return {
      state: { accumulated, direction, lastEventAt: now, triggeredAt: null },
      page: 0,
    };
  }
  return {
    state: { accumulated: 0, direction, lastEventAt: now, triggeredAt: now },
    page: direction,
  };
}
