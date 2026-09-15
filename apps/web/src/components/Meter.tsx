import { DEFAULT_METER_DB } from '@flwc/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import { meterStore } from '../store/meter-store.js';

export const METER_DB_MIN = -60;
export const METER_DB_MAX = 0;
export const PEAK_HOLD_MS = 1500;

export function clampMeterDb(value: number): number {
  return Math.min(METER_DB_MAX, Math.max(METER_DB_MIN, value));
}

export function meterLevelClass(value: number): 'safe' | 'warning' | 'clip' {
  if (value > -6) {
    return 'clip';
  }
  if (value > -18) {
    return 'warning';
  }
  return 'safe';
}

function meterRatio(value: number): number {
  return (clampMeterDb(value) - METER_DB_MIN) / (METER_DB_MAX - METER_DB_MIN);
}

/**
 * The bottom of the scale is silence, not −60 dB of it: everything quieter reads the same there,
 * so printing the figure would claim a measurement the meter cannot make. The fader says the same
 * thing at the bottom of its own scale.
 */
export function formatMeterDb(value: number): string {
  return value <= METER_DB_MIN ? '-∞' : clampMeterDb(value).toFixed(1);
}

interface MeterProps {
  id: string;
  label: string;
  active: boolean;
}

export function Meter({ id, label, active }: MeterProps) {
  const rawValue = useStore(meterStore, (state) => state.meters[id] ?? DEFAULT_METER_DB);
  const clipping = useStore(meterStore, (state) => state.clipping[id] ?? false);
  const value = clampMeterDb(rawValue);
  const currentRef = useRef(value);
  const peakRef = useRef(value);
  const timerRef = useRef<number | undefined>(undefined);
  const [peak, setPeak] = useState(value);

  /*
   * The peak is taken as soon as it is read, not on a later turn of the event loop.
   *
   * Deferring it used to cost the line its way down. Taking a new peak cancels the hold that is
   * running, so a deferred rise leaves a window in which the old hold is already gone and the new
   * one has not been set; a frame arriving inside that window cancels the deferred rise along with
   * it, and nothing is left to bring the line back down. It stays where it is for the rest of the
   * session while the bar below it falls to silence.
   *
   * That window is narrow but it is exactly where a stopping signal lands: a paused video ends on
   * a rise followed immediately by silence, and the two frames reach the page in the same task. A
   * microphone never triggers it, because its noise floor walks the level down over many frames
   * and any one of them would have closed the window.
   */
  useEffect(() => {
    currentRef.current = value;
    if (value <= peakRef.current) {
      return;
    }
    peakRef.current = value;
    setPeak(value);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      peakRef.current = currentRef.current;
      setPeak(currentRef.current);
    }, PEAK_HOLD_MS);
  }, [value]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      className={`meter meter--${meterLevelClass(value)} ${clipping ? 'is-clipping' : ''} ${active ? '' : 'is-frozen'}`}
      aria-label={`${label} meter`}
      data-clipping={clipping}
    >
      <div className="meter__well" aria-hidden="true">
        <div className="meter__zones" />
        {/*
         * Both the bar and the peak move by transform alone, so a reading costs the compositor a
         * translation instead of costing the main thread a paint and a layout twenty times a
         * second. The window slides down to uncover the reading and the bar inside it slides back
         * up by the same amount, which keeps the colour gradient pinned to the well: the two
         * translations are the same number with opposite signs, so they stay aligned partway
         * through the transition as well as at rest.
         */}
        <div
          className="meter__fill"
          style={{ '--meter-ratio': meterRatio(value) } as CSSProperties}
        >
          <div className="meter__fill-bar" />
        </div>
        <div className="meter__peak" style={{ '--meter-peak': meterRatio(peak) } as CSSProperties}>
          <div className="meter__peak-line" />
        </div>
      </div>
      <output className="meter__readout" aria-label={`${label} meter value`}>
        <span className="readout__label">MTR</span>
        <span className="readout__value">{formatMeterDb(value)}</span>
        <small>dB</small>
      </output>
    </div>
  );
}
