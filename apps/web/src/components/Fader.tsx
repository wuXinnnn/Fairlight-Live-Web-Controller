import { LEVEL_DB_MAX, LEVEL_DB_MIN } from '@flwc/shared';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  FADER_TICKS,
  clampLevelDb,
  formatLevelDb,
  levelDbToRatio,
  parseLevelInput,
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

const CAP_DRAG_THRESHOLD_PX = 3;
const CAP_DOUBLE_CLICK_MS = 500;
const CAP_DOUBLE_CLICK_Y_PX = 12;
const UNITY_LEVEL_DB = 0;

function isCapTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.fader__cap') !== null;
}

function levelFromRelativePointer(
  startRatio: number,
  startY: number,
  clientY: number,
  trackHeight: number,
): number {
  const nextRatio = startRatio + (startY - clientY) / trackHeight;
  return Math.round(ratioToLevelDb(nextRatio) * 10) / 10;
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
  const capGrabRef = useRef<{ startY: number; startRatio: number; armed: boolean } | undefined>(
    undefined,
  );
  const unityFromPointerRef = useRef(false);
  const lastCapPointerDownRef = useRef<{ at: number; y: number } | undefined>(undefined);
  const skipInputCommitRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [inputInvalid, setInputInvalid] = useState(false);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    document.documentElement.classList.add('fader-cap-dragging');
    return () => {
      document.documentElement.classList.remove('fader-cap-dragging');
    };
  }, [dragging]);

  const applyExactValue = (nextValue: number) => {
    onInteractionStart();
    onValueChange(nextValue);
    onCommit(nextValue);
  };

  const isCapDoubleClick = (event: PointerEvent<HTMLDivElement>): boolean => {
    if (event.detail >= 2) {
      return true;
    }
    const lastClick = lastCapPointerDownRef.current;
    return (
      lastClick !== undefined &&
      performance.now() - lastClick.at <= CAP_DOUBLE_CLICK_MS &&
      Math.abs(event.clientY - lastClick.y) <= CAP_DOUBLE_CLICK_Y_PX
    );
  };

  const cancelEditing = () => {
    if (!editing) {
      return;
    }
    skipInputCommitRef.current = true;
    setEditing(false);
    setInputInvalid(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !isCapTarget(event.target)) {
      return;
    }
    event.preventDefault();
    cancelEditing();
    if (isCapDoubleClick(event)) {
      lastCapPointerDownRef.current = undefined;
      unityFromPointerRef.current = true;
      applyExactValue(UNITY_LEVEL_DB);
      return;
    }
    lastCapPointerDownRef.current = { at: performance.now(), y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers have no capture target.
    }
    capGrabRef.current = {
      startY: event.clientY,
      startRatio: levelDbToRatio(value),
      armed: true,
    };
    latestValueRef.current = value;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) {
      return;
    }
    const capGrab = capGrabRef.current;
    if (capGrab === undefined) {
      return;
    }
    if (capGrab.armed === true) {
      if (Math.abs(event.clientY - capGrab.startY) < CAP_DRAG_THRESHOLD_PX) {
        return;
      }
      capGrab.armed = false;
      onInteractionStart();
    }
    const bounds = trackRef.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.height === 0) {
      return;
    }
    const nextValue = levelFromRelativePointer(
      capGrab.startRatio,
      capGrab.startY,
      event.clientY,
      bounds.height,
    );
    latestValueRef.current = nextValue;
    onValueChange(nextValue);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already have been released.
    }
    const skippedCapCommit = capGrabRef.current?.armed === true;
    capGrabRef.current = undefined;
    setDragging(false);
    if (!skippedCapCommit) {
      onCommit(latestValueRef.current);
    }
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || !isCapTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (unityFromPointerRef.current) {
      unityFromPointerRef.current = false;
      return;
    }
    cancelEditing();
    applyExactValue(UNITY_LEVEL_DB);
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

  const startEditing = () => {
    if (disabled) {
      return;
    }
    skipInputCommitRef.current = false;
    setDraftValue(clampLevelDb(value).toFixed(1));
    setInputInvalid(false);
    setEditing(true);
  };

  const commitInput = (cancelInvalid: boolean) => {
    const parsed = parseLevelInput(draftValue);
    if (parsed === null) {
      if (cancelInvalid) {
        setEditing(false);
        setInputInvalid(false);
      } else {
        setInputInvalid(true);
      }
      return;
    }
    applyExactValue(parsed);
    setEditing(false);
    setInputInvalid(false);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitInput(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
      setInputInvalid(false);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraftValue(event.target.value);
    setInputInvalid(false);
  };

  const handleInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };

  const handleInputBlur = () => {
    if (skipInputCommitRef.current) {
      skipInputCommitRef.current = false;
      return;
    }
    commitInput(true);
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
        onDoubleClick={handleDoubleClick}
      >
        <div className="fader__unity" aria-hidden="true" />
        <div className="fader__slot" aria-hidden="true" />
        <div className="fader__cap" style={{ bottom: `${ratio * 100}%` }} aria-hidden="true">
          <span />
        </div>
      </div>
      <output
        className={`fader__readout ${inputInvalid ? 'is-invalid' : ''}`}
        aria-label={`${label} level value`}
      >
        {editing ? (
          <input
            type="number"
            min={LEVEL_DB_MIN}
            max={LEVEL_DB_MAX}
            step="0.1"
            value={draftValue}
            disabled={disabled}
            aria-label={`${label} exact level`}
            aria-invalid={inputInvalid}
            autoFocus
            onFocus={handleInputFocus}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
          />
        ) : (
          <button
            type="button"
            aria-label={`Edit ${label} level`}
            disabled={disabled}
            onClick={startEditing}
          >
            {formatLevelDb(clampedValue)}
          </button>
        )}
        <small>dB</small>
      </output>
    </div>
  );
}
