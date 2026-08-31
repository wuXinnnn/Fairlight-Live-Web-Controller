import { DEFAULT_METER_DB } from '@flwc/shared';
import { useEffect, useRef, useState } from 'react';
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

interface MeterProps {
  id: string;
  label: string;
  active: boolean;
}

export function Meter({ id, label, active }: MeterProps) {
  const rawValue = useStore(meterStore, (state) => state.meters[id] ?? DEFAULT_METER_DB);
  const value = clampMeterDb(rawValue);
  const currentRef = useRef(value);
  const timerRef = useRef<number | undefined>(undefined);
  const [peak, setPeak] = useState(value);
  currentRef.current = value;

  useEffect(() => {
    if (value <= peak) {
      return;
    }
    setPeak(value);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPeak(currentRef.current);
    }, PEAK_HOLD_MS);
  }, [peak, value]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      className={`meter meter--${meterLevelClass(value)} ${active ? '' : 'is-frozen'}`}
      aria-label={`${label} meter`}
    >
      <div className="meter__well" aria-hidden="true">
        <div className="meter__zones" />
        <div className="meter__fill" style={{ height: `${meterRatio(value) * 100}%` }} />
        <div className="meter__peak" style={{ bottom: `${meterRatio(peak) * 100}%` }} />
      </div>
      <output className="meter__readout" aria-label={`${label} meter value`}>
        {value.toFixed(1)}
        <small>dB</small>
      </output>
    </div>
  );
}
