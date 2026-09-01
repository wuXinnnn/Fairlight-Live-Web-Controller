import { LEVEL_DB_MAX, LEVEL_DB_MIN } from '@flwc/shared';

const SCALE_POINTS = [
  { db: -100, ratio: 0 },
  { db: -60, ratio: 0.12 },
  { db: -40, ratio: 0.3 },
  { db: -20, ratio: 0.52 },
  { db: -10, ratio: 0.68 },
  { db: 0, ratio: 0.84 },
  { db: 10, ratio: 1 },
] as const;

export const FADER_TICKS = [10, 0, -10, -20, -40, -60, -100] as const;
export const FADER_FINE_STEP_DB = 1;
export const FADER_COARSE_STEP_DB = 10;

export function clampLevelDb(value: number): number {
  return Math.min(LEVEL_DB_MAX, Math.max(LEVEL_DB_MIN, value));
}

function interpolate(
  value: number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number,
): number {
  const progress = (value - inputStart) / (inputEnd - inputStart);
  return outputStart + progress * (outputEnd - outputStart);
}

export function levelDbToRatio(value: number): number {
  const clamped = clampLevelDb(value);

  for (let index = 1; index < SCALE_POINTS.length; index += 1) {
    const lower = SCALE_POINTS[index - 1];
    const upper = SCALE_POINTS[index];
    if (lower !== undefined && upper !== undefined && clamped <= upper.db) {
      return interpolate(clamped, lower.db, upper.db, lower.ratio, upper.ratio);
    }
  }

  return 1;
}

export function ratioToLevelDb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));

  for (let index = 1; index < SCALE_POINTS.length; index += 1) {
    const lower = SCALE_POINTS[index - 1];
    const upper = SCALE_POINTS[index];
    if (lower !== undefined && upper !== undefined && clamped <= upper.ratio) {
      return clampLevelDb(interpolate(clamped, lower.ratio, upper.ratio, lower.db, upper.db));
    }
  }

  return LEVEL_DB_MAX;
}

export function stepLevelDb(value: number, direction: -1 | 1, coarse = false): number {
  const step = coarse ? FADER_COARSE_STEP_DB : FADER_FINE_STEP_DB;
  return clampLevelDb(Math.round((value + direction * step) * 10) / 10);
}

export function formatLevelDb(value: number): string {
  const clamped = clampLevelDb(value);
  if (clamped <= LEVEL_DB_MIN) {
    return '-∞';
  }
  return `${clamped > 0 ? '+' : ''}${clamped.toFixed(1)}`;
}

export function parseLevelInput(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < LEVEL_DB_MIN || parsed > LEVEL_DB_MAX) {
    return null;
  }
  return parsed;
}
