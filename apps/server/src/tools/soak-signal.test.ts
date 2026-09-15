import { createRequiredDump, loadDumpTree } from '@flwc/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  collectMeterPaths,
  isPeaking,
  loudnessSignal,
  meterSignal,
  SOAK_LOUDNESS_MAX_LUFS,
  SOAK_LOUDNESS_MIN_LUFS,
  SOAK_LOUDNESS_PERIOD_S,
  SOAK_SIGNAL_CEILING_DB,
  SOAK_SIGNAL_FLOOR_DB,
  SOAK_SIGNAL_MAX_DB,
  SOAK_SIGNAL_MIN_DB,
  SOAK_SIGNAL_PEAK_DB,
  SOAK_SIGNAL_PEAK_STAGGER_S,
  SOAK_SIGNAL_PEAK_WINDOW_S,
  SOAK_SIGNAL_PERIOD_S,
  SOAK_SIGNAL_PERIOD_STAGGER_S,
} from './soak-signal.js';

const CHANNELS = 10;
const STEP_S = 0.05;
const SPAN_S = 200;

function sweep(random: () => number, visit: (t: number, index: number, value: number) => void) {
  for (let t = 0; t < SPAN_S; t += STEP_S) {
    for (let index = 0; index < CHANNELS; index += 1) {
      visit(t, index, meterSignal(t, index, { random }));
    }
  }
}

describe('meterSignal', () => {
  it('stays inside the meter scale at either extreme of the noise', () => {
    for (const random of [() => 0, () => 0.5, () => 1]) {
      sweep(random, (t, index, value) => {
        expect(
          value >= SOAK_SIGNAL_MIN_DB && value <= SOAK_SIGNAL_MAX_DB,
          `${value} at t=${t} on channel ${index}`,
        ).toBe(true);
      });
    }
  });

  it('keeps everything that is not a peak inside the body of the scale', () => {
    for (const random of [() => 0, () => 1]) {
      sweep(random, (t, index, value) => {
        if (value === SOAK_SIGNAL_PEAK_DB) {
          return;
        }
        expect(
          value >= SOAK_SIGNAL_FLOOR_DB && value <= SOAK_SIGNAL_CEILING_DB,
          `${value} at t=${t} on channel ${index}`,
        ).toBe(true);
      });
    }
  });

  it('peaks once per cycle on every channel', () => {
    for (let index = 0; index < CHANNELS; index += 1) {
      const period = SOAK_SIGNAL_PERIOD_S + index * SOAK_SIGNAL_PERIOD_STAGGER_S;
      let starts = 0;
      let wasPeaking = isPeaking(-STEP_S, index);
      for (let t = 0; t < SPAN_S; t += STEP_S) {
        const peaking = isPeaking(t, index);
        if (peaking && !wasPeaking) {
          starts += 1;
        }
        wasPeaking = peaking;
      }
      expect(starts).toBeGreaterThanOrEqual(Math.floor(SPAN_S / period) - 1);
      expect(starts).toBeLessThanOrEqual(Math.ceil(SPAN_S / period) + 1);
    }
  });

  it('holds each peak long enough for the clip indicator to latch', () => {
    // The indicator needs two consecutive frames at or above zero; at 20 Hz that is 100 ms.
    expect(SOAK_SIGNAL_PEAK_WINDOW_S).toBeGreaterThan(2 / 20);
    let frames = 0;
    for (let t = 0; t < SOAK_SIGNAL_PEAK_WINDOW_S; t += 1 / 20) {
      if (meterSignal(t, 0, { random: () => 0.5 }) >= 0) {
        frames += 1;
      }
    }
    expect(frames).toBeGreaterThanOrEqual(2);
  });

  it('does not let two channels peak together', () => {
    // Channel 3 starts its first peak a whole stagger after channel 0 has finished its own.
    expect(SOAK_SIGNAL_PEAK_STAGGER_S).toBeGreaterThan(SOAK_SIGNAL_PEAK_WINDOW_S);
    for (let t = 0; t < SPAN_S; t += STEP_S) {
      const peaking = [0, 1, 2, 3].filter((index) => isPeaking(t, index));
      expect(peaking.length, `channels ${peaking.join()} peaked together at t=${t}`).toBeLessThan(
        2,
      );
    }
  });

  it('gives each channel its own cycle length', () => {
    const periods = [0, 1, 2].map(
      (index) => SOAK_SIGNAL_PERIOD_S + index * SOAK_SIGNAL_PERIOD_STAGGER_S,
    );
    expect(new Set(periods).size).toBe(periods.length);
  });

  it('is a pure function of its inputs and takes exactly one number per call', () => {
    const random = vi.fn(() => 0.25);
    // A moment that is not inside a peak, so the noise is actually consulted.
    const first = meterSignal(5, 0, { random });
    const second = meterSignal(5, 0, { random });
    expect(first).toBe(second);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('reads a negative time the same way it reads a positive one', () => {
    expect(Number.isNaN(meterSignal(-3, 2, { random: () => 0.5 }))).toBe(false);
    expect(meterSignal(-3, 2, { random: () => 0.5 })).toBeGreaterThanOrEqual(SOAK_SIGNAL_MIN_DB);
  });
});

describe('loudnessSignal', () => {
  it('drifts the integrated reading across its range and no further', () => {
    const seen: number[] = [];
    for (let t = 0; t < SOAK_LOUDNESS_PERIOD_S * 2; t += 0.5) {
      const { integratedLufs } = loudnessSignal(t, 4, { random: () => 0.5 });
      expect(integratedLufs).toBeGreaterThanOrEqual(SOAK_LOUDNESS_MIN_LUFS);
      expect(integratedLufs).toBeLessThanOrEqual(SOAK_LOUDNESS_MAX_LUFS);
      seen.push(integratedLufs);
    }
    expect(Math.min(...seen)).toBeLessThan(SOAK_LOUDNESS_MIN_LUFS + 0.5);
    expect(Math.max(...seen)).toBeGreaterThan(SOAK_LOUDNESS_MAX_LUFS - 0.5);
  });

  it('follows the loudest channel on the desk', () => {
    const random = () => 0.5;
    for (const t of [0, 1.7, 9.4, 21.3]) {
      const expected = Math.max(...[0, 1, 2, 3].map((index) => meterSignal(t, index, { random })));
      expect(loudnessSignal(t, 4, { random }).truePeakDbtp).toBe(expected);
    }
  });

  it('reports silence when the desk has no channels', () => {
    expect(loudnessSignal(3, 0, { random: () => 0.5 }).truePeakDbtp).toBe(SOAK_SIGNAL_MIN_DB);
  });
});

describe('collectMeterPaths', () => {
  it('finds the meters of the required fixture in tree order', () => {
    expect(collectMeterPaths(createRequiredDump())).toEqual([
      'channel/channel1/meter',
      'main/main1/meter',
      'aux/aux1/meter',
    ]);
  });

  it('takes only the roots this project maps to strips', () => {
    const paths = collectMeterPaths(loadDumpTree());
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => /^(channel|main|aux)\//.test(path))).toBe(true);
    expect(paths.every((path) => path.endsWith('/meter'))).toBe(true);
    // The desk carries meters under monitor and talkback too; feeding those shows nothing.
    expect(paths.some((path) => path.startsWith('monitor/'))).toBe(false);
  });

  it('returns nothing for a tree with no mapped roots', () => {
    expect(collectMeterPaths({ dumpedAt: '', host: '', port: 0, nodes: [], errors: [] })).toEqual(
      [],
    );
  });
});
