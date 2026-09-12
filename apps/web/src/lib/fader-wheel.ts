/**
 * Turns wheel movement into fader steps. The reducer knows nothing about decibels — it only says
 * how many steps to take and which way, so the caller can apply the same fine and coarse steps
 * the keyboard uses.
 */

/** Wheel travel that makes one step. */
export const FADER_WHEEL_STEP_PX = 50;

export interface FaderWheelState {
  accumulated: number;
  direction: -1 | 0 | 1;
}

export const INITIAL_FADER_WHEEL_STATE: FaderWheelState = { accumulated: 0, direction: 0 };

/**
 * Scrolling up (a negative `deltaY`) raises the fader. Travel accumulates until it is worth a
 * step and the remainder carries over, so slow trackpad movement still gets there; one event
 * worth several steps yields all of them at once. Turning around throws the accumulation away,
 * so a reversal takes effect immediately rather than first paying off the previous direction.
 */
export function reduceFaderWheel(
  state: FaderWheelState,
  input: { deltaY: number },
): { state: FaderWheelState; steps: number } {
  const { deltaY } = input;
  if (deltaY === 0) {
    return { state, steps: 0 };
  }
  const direction = deltaY < 0 ? 1 : -1;
  const accumulated = (state.direction === direction ? state.accumulated : 0) + Math.abs(deltaY);
  const steps = Math.floor(accumulated / FADER_WHEEL_STEP_PX);
  return {
    state: { accumulated: accumulated - steps * FADER_WHEEL_STEP_PX, direction },
    // Guard the sign of zero, so "no steps" compares equal however the wheel was turning.
    steps: steps === 0 ? 0 : steps * direction,
  };
}
