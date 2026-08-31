import { LEVEL_DB_MAX, LEVEL_DB_MIN } from '@flwc/shared';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  FADER_TICKS,
  clampLevelDb,
  formatLevelDb,
  levelDbToRatio,
  ratioToLevelDb,
  stepLevelDb,
} from '../lib/fader-scale.js';

interface FaderProps {
  label: string;
  value: number;
  disabled?: boolean;
  pending?: boolean;
  onInteractionStart(): void;
  onValueChange(value: number): void;
  onCommit(value: number): void;
}

export function Fader({
  label,
  value,
  disabled = false,
  pending = false,
  onInteractionStart,
  onValueChange,
  onCommit,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);

  const valueFromPointer = (clientY: number): number => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.height === 0) {
      return value;
    }
    const ratio = 1 - (clientY - bounds.top) / bounds.height;
    return Math.round(ratioToLevelDb(ratio) * 10) / 10;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    onInteractionStart();
    const nextValue = valueFromPointer(event.clientY);
    latestValueRef.current = nextValue;
    onValueChange(nextValue);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) {
      return;
    }
    const nextValue = valueFromPointer(event.clientY);
    latestValueRef.current = nextValue;
    onValueChange(nextValue);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onCommit(latestValueRef.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    let nextValue: number | undefined;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      nextValue = stepLevelDb(value, 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      nextValue = stepLevelDb(value, -1);
    } else if (event.key === 'PageUp') {
      nextValue = stepLevelDb(value, 1, true);
    } else if (event.key === 'PageDown') {
      nextValue = stepLevelDb(value, -1, true);
    } else if (event.key === 'Home') {
      nextValue = LEVEL_DB_MIN;
    } else if (event.key === 'End') {
      nextValue = LEVEL_DB_MAX;
    }
    if (nextValue === undefined) {
      return;
    }
    event.preventDefault();
    onInteractionStart();
    onValueChange(nextValue);
    onCommit(nextValue);
  };

  const clampedValue = clampLevelDb(value);
  const ratio = levelDbToRatio(clampedValue);

  return (
    <div className={`fader ${pending ? 'is-pending' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div className="fader__scale" aria-hidden="true">
        {FADER_TICKS.map((tick) => (
          <span
            className="fader__tick"
            key={tick}
            style={{ bottom: `${levelDbToRatio(tick) * 100}%` }}
          >
            {tick === LEVEL_DB_MIN ? '-∞' : tick > 0 ? `+${tick}` : tick}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className="fader__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} level`}
        aria-valuemin={LEVEL_DB_MIN}
        aria-valuemax={LEVEL_DB_MAX}
        aria-valuenow={clampedValue}
        aria-valuetext={`${formatLevelDb(clampedValue)} dB`}
        aria-disabled={disabled}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div className="fader__unity" aria-hidden="true" />
        <div className="fader__slot" aria-hidden="true" />
        <div className="fader__cap" style={{ bottom: `${ratio * 100}%` }} aria-hidden="true">
          <span />
        </div>
      </div>
      <output className="fader__readout" aria-label={`${label} level value`}>
        {formatLevelDb(clampedValue)}
        <small>dB</small>
      </output>
    </div>
  );
}
