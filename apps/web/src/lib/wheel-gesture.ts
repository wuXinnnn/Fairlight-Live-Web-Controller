/**
 * Who owns the wheel right now.
 *
 * A fader track and the pager both listen for wheel events, and a single gesture must not be
 * split between them: the pointer drifts off a fader mid-scroll, or a page turn slides a fresh
 * fader under a still-coasting trackpad. So the first event of a gesture claims ownership and
 * keeps it until the wheel falls silent; everyone else recognises they are not the owner,
 * ignores the event, and keeps the owner's gesture alive.
 */

/** Silence that ends a gesture. */
export const WHEEL_GESTURE_IDLE_MS = 150;

/** The pager, or the fader for a particular channel. */
export type WheelOwner = 'page' | { fader: string };

export interface WheelGestureState {
  owner: WheelOwner | null;
  lastEventAt: number;
}

export const INITIAL_WHEEL_GESTURE_STATE: WheelGestureState = { owner: null, lastEventAt: 0 };

export function sameOwner(a: WheelOwner | null, b: WheelOwner | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a === 'page' || b === 'page') {
    return a === b;
  }
  return a.fader === b.fader;
}

/** The owner, or null once the gesture has gone quiet. */
export function currentOwner(state: WheelGestureState, now: number): WheelOwner | null {
  if (state.owner === null || now - state.lastEventAt >= WHEEL_GESTURE_IDLE_MS) {
    return null;
  }
  return state.owner;
}

/** Hands the wheel to `owner`; whatever the previous gesture was is replaced outright. */
export function claim(
  _state: WheelGestureState,
  owner: WheelOwner,
  now: number,
): WheelGestureState {
  return { owner, lastEventAt: now };
}

export function extend(state: WheelGestureState, now: number): WheelGestureState {
  return { owner: state.owner, lastEventAt: now };
}

export interface WheelGestureTracker {
  /** Claims the wheel, or reports who already has it — an owner is never displaced mid-gesture. */
  begin(owner: WheelOwner, onEnd: () => void): WheelOwner;
  /** Keeps the current gesture alive. */
  touch(): void;
  owner(): WheelOwner | null;
  /** Drops the gesture without ending it; for tests, which share the module singleton. */
  reset(): void;
}

export interface GestureClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function createWheelGestureTracker(clock: GestureClock): WheelGestureTracker {
  let state = INITIAL_WHEEL_GESTURE_STATE;
  let onEnd: (() => void) | null = null;
  let handle: unknown = null;

  const cancelTimer = () => {
    if (handle !== null) {
      clock.clearTimeout(handle);
      handle = null;
    }
  };

  const finish = () => {
    handle = null;
    const ending = onEnd;
    state = INITIAL_WHEEL_GESTURE_STATE;
    onEnd = null;
    ending?.();
  };

  const schedule = () => {
    cancelTimer();
    handle = clock.setTimeout(finish, WHEEL_GESTURE_IDLE_MS);
  };

  return {
    begin(owner, end) {
      const now = clock.now();
      const existing = currentOwner(state, now);
      if (existing !== null) {
        state = extend(state, now);
        schedule();
        return existing;
      }
      // The previous gesture expired without its timer having run yet; close it out properly so
      // its owner still gets exactly one end callback.
      if (onEnd !== null) {
        cancelTimer();
        finish();
      }
      state = claim(state, owner, now);
      onEnd = end;
      schedule();
      return owner;
    },
    touch() {
      if (state.owner === null) {
        return;
      }
      state = extend(state, clock.now());
      schedule();
    },
    owner() {
      return currentOwner(state, clock.now());
    },
    reset() {
      cancelTimer();
      onEnd = null;
      state = INITIAL_WHEEL_GESTURE_STATE;
    },
  };
}

/** The tracker the application uses. The clock is read lazily so fake timers can replace it. */
export const wheelGestureTracker = createWheelGestureTracker({
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
});
