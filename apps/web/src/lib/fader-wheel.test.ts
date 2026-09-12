import { describe, expect, it } from 'vitest';
import { FADER_WHEEL_STEP_PX, INITIAL_FADER_WHEEL_STATE, reduceFaderWheel } from './fader-wheel.js';

describe('reduceFaderWheel', () => {
  it('turns one mouse notch into two steps downwards', () => {
    const { state, steps } = reduceFaderWheel(INITIAL_FADER_WHEEL_STATE, { deltaY: 100 });

    expect(steps).toBe(-2);
    expect(state).toEqual({ accumulated: 0, direction: -1 });
  });

  it('raises the fader when the wheel goes up', () => {
    expect(reduceFaderWheel(INITIAL_FADER_WHEEL_STATE, { deltaY: -100 }).steps).toBe(2);
  });

  it('accumulates small trackpad movement and carries the remainder', () => {
    let state = INITIAL_FADER_WHEEL_STATE;
    let total = 0;
    for (let event = 0; event < 5; event += 1) {
      const result = reduceFaderWheel(state, { deltaY: -12 });
      state = result.state;
      total += result.steps;
    }

    expect(total).toBe(1);
    expect(state).toEqual({ accumulated: 60 - FADER_WHEEL_STEP_PX, direction: 1 });
  });

  it('throws the accumulation away when the wheel turns around', () => {
    const { state } = reduceFaderWheel(INITIAL_FADER_WHEEL_STATE, { deltaY: -40 });
    expect(state.accumulated).toBe(40);

    const reversed = reduceFaderWheel(state, { deltaY: 40 });
    expect(reversed.steps).toBe(0);
    expect(reversed.state).toEqual({ accumulated: 40, direction: -1 });
  });

  it('yields every step a single large event is worth', () => {
    expect(reduceFaderWheel(INITIAL_FADER_WHEEL_STATE, { deltaY: -260 })).toEqual({
      steps: 5,
      state: { accumulated: 10, direction: 1 },
    });
  });

  it('ignores an event that does not move', () => {
    expect(reduceFaderWheel(INITIAL_FADER_WHEEL_STATE, { deltaY: 0 })).toEqual({
      steps: 0,
      state: INITIAL_FADER_WHEEL_STATE,
    });
  });
});
