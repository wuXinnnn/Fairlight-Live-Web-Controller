import { describe, expect, it } from 'vitest';
import {
  clampLevelDb,
  formatLevelDb,
  levelDbToRatio,
  ratioToLevelDb,
  stepLevelDb,
} from './fader-scale.js';

describe('fader scale', () => {
  it('clamps values to the supported range', () => {
    expect(clampLevelDb(-200)).toBe(-100);
    expect(clampLevelDb(20)).toBe(10);
    expect(clampLevelDb(-6.5)).toBe(-6.5);
  });

  it('maps endpoints and round-trips important marks', () => {
    expect(levelDbToRatio(-100)).toBe(0);
    expect(levelDbToRatio(10)).toBe(1);
    expect(ratioToLevelDb(-1)).toBe(-100);
    expect(ratioToLevelDb(2)).toBe(10);
    for (const value of [-100, -60, -40, -20, -10, 0, 10]) {
      expect(ratioToLevelDb(levelDbToRatio(value))).toBeCloseTo(value);
    }
  });

  it('applies fine and coarse keyboard steps at the boundaries', () => {
    expect(stepLevelDb(-10, 1)).toBe(-9);
    expect(stepLevelDb(-10, -1, true)).toBe(-20);
    expect(stepLevelDb(9.5, 1)).toBe(10);
    expect(stepLevelDb(-95, -1, true)).toBe(-100);
  });

  it('formats unity, positive values, and negative infinity', () => {
    expect(formatLevelDb(-100)).toBe('-∞');
    expect(formatLevelDb(0)).toBe('0.0');
    expect(formatLevelDb(3.25)).toBe('+3.3');
  });
});
