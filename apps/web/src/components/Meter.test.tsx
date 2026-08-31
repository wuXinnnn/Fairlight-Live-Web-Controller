import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMetersFrame, resetMeterStore } from '../store/meter-store.js';
import {
  METER_DB_MAX,
  METER_DB_MIN,
  Meter,
  PEAK_HOLD_MS,
  clampMeterDb,
  meterLevelClass,
} from './Meter.js';

describe('Meter', () => {
  beforeEach(() => {
    resetMeterStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps out-of-range readings and selects color zones', () => {
    expect(clampMeterDb(-99)).toBe(METER_DB_MIN);
    expect(clampMeterDb(12)).toBe(METER_DB_MAX);
    expect(meterLevelClass(-18)).toBe('safe');
    expect(meterLevelClass(-10)).toBe('warning');
    expect(meterLevelClass(-5)).toBe('clip');

    applyMetersFrame({ meters: [['channel/1', 8]] });
    render(<Meter id="channel/1" label="BASS" active />);
    expect(screen.getByLabelText('BASS meter value')).toHaveTextContent('0.0dB');
    expect(screen.getByLabelText('BASS meter')).toHaveClass('meter--clip');
  });

  it('holds a peak before returning to the current reading', () => {
    const { container } = render(<Meter id="channel/1" label="BASS" active />);
    act(() => {
      applyMetersFrame({ meters: [['channel/1', -3]] });
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const peak = container.querySelector<HTMLElement>('.meter__peak');
    expect(peak?.style.bottom).toBe('95%');

    act(() => {
      applyMetersFrame({ meters: [['channel/1', -30]] });
      vi.advanceTimersByTime(PEAK_HOLD_MS - 1);
    });
    expect(peak?.style.bottom).toBe('95%');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(peak?.style.bottom).toBe('50%');
  });

  it('visually freezes when the control surface is inactive', () => {
    render(<Meter id="channel/1" label="BASS" active={false} />);
    expect(screen.getByLabelText('BASS meter')).toHaveClass('is-frozen');
  });
});
