import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMetersFrame, resetMeterStore } from '../store/meter-store.js';
import {
  METER_DB_MAX,
  METER_DB_MIN,
  Meter,
  PEAK_HOLD_MS,
  clampMeterDb,
  formatMeterDb,
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

  it('reads the bottom of the scale as silence rather than as a figure', () => {
    expect(formatMeterDb(METER_DB_MIN)).toBe('-∞');
    // Everything below the floor reads the same there, so none of it may print a number.
    expect(formatMeterDb(-99)).toBe('-∞');
    expect(formatMeterDb(METER_DB_MIN + 0.1)).toBe('-59.9');

    applyMetersFrame({ meters: [['channel/1', -80]] });
    render(<Meter id="channel/1" label="BASS" active />);
    expect(screen.getByLabelText('BASS meter value')).toHaveTextContent('-∞dB');
  });

  it('reveals a fixed meter gradient by sliding it and warns after repeated 0 dB frames', () => {
    applyMetersFrame({ meters: [['channel/1', -30]] });
    const { container } = render(<Meter id="channel/1" label="BASS" active />);
    const fill = container.querySelector<HTMLElement>('.meter__fill');
    expect(fill?.style.getPropertyValue('--meter-ratio')).toBe('0.5');
    // The gradient slides back by whatever the window slid forward, so it stays on the scale.
    expect(container.querySelector('.meter__fill-bar')).not.toBeNull();
    expect(screen.getByLabelText('BASS meter')).toHaveAttribute('data-clipping', 'false');

    act(() => {
      applyMetersFrame({ meters: [['channel/1', 0]] });
      applyMetersFrame({ meters: [['channel/1', 0]] });
    });
    expect(screen.getByLabelText('BASS meter')).toHaveClass('is-clipping');
    expect(screen.getByLabelText('BASS meter')).toHaveAttribute('data-clipping', 'true');
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
    expect(peak?.style.getPropertyValue('--meter-peak')).toBe('0.95');

    act(() => {
      applyMetersFrame({ meters: [['channel/1', -30]] });
      vi.advanceTimersByTime(PEAK_HOLD_MS - 1);
    });
    expect(peak?.style.getPropertyValue('--meter-peak')).toBe('0.95');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(peak?.style.getPropertyValue('--meter-peak')).toBe('0.5');
  });

  it('brings the peak down after a rise that silence arrived on top of', () => {
    const { container } = render(<Meter id="channel/1" label="BASS" active />);
    const peak = container.querySelector<HTMLElement>('.meter__peak');
    const fill = container.querySelector<HTMLElement>('.meter__fill');

    act(() => {
      applyMetersFrame({ meters: [['channel/1', -3]] });
    });
    // A turn of the loop, so a peak that is committed late has had its chance to be committed.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(peak?.style.getPropertyValue('--meter-peak')).toBe('0.95');

    /*
     * A rise, and then the source stops before the next turn of the loop — a paused video rather
     * than a microphone walking down its noise floor. Taking the rise cancels the hold that was
     * running, so deferring it left a window with no hold set and no rise committed; the frame
     * carrying silence closed that window and the line was stranded above a bar that had already
     * fallen. The two frames are dispatched separately on purpose: batching them into one render
     * would collapse the very gap this is about.
     */
    act(() => {
      applyMetersFrame({ meters: [['channel/1', -1]] });
    });
    act(() => {
      applyMetersFrame({ meters: [['channel/1', -60]] });
    });
    act(() => {
      vi.advanceTimersByTime(PEAK_HOLD_MS * 2);
    });

    expect(fill?.style.getPropertyValue('--meter-ratio')).toBe('0');
    expect(peak?.style.getPropertyValue('--meter-peak')).toBe('0');
  });

  it('visually freezes when the control surface is inactive', () => {
    render(<Meter id="channel/1" label="BASS" active={false} />);
    expect(screen.getByLabelText('BASS meter')).toHaveClass('is-frozen');
  });
});
