import { LEVEL_DB_MAX, LEVEL_DB_MIN } from '@flwc/shared';
import {
  useCallback,
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
import { INITIAL_FADER_WHEEL_STATE, reduceFaderWheel } from '../lib/fader-wheel.js';
import { normalizeWheelDelta } from '../lib/wheel-delta.js';
import { sameOwner, wheelGestureTracker, type WheelOwner } from '../lib/wheel-gesture.js';

interface FaderProps {
  label: string;
  /** Identifies this fader to the wheel gesture tracker; the channel id. */
  wheelId: string;
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
  wheelId,
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
  const wheelStateRef = useRef(INITIAL_FADER_WHEEL_STATE);
  const wheelActiveRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [inputInvalid, setInputInvalid] = useState(false);

  const latest = useRef({ disabled, dragging, value, onInteractionStart, onValueChange, onCommit });
  useEffect(() => {
    latest.current = { disabled, dragging, value, onInteractionStart, onValueChange, onCommit };
  });

  /**
   * Ends a wheel gesture. The wheel does not commit per step the way the keyboard does: a
   * gesture is one continuous move of the fader, so it writes once when the wheel stops.
   */
  const commitWheelGesture = useCallback(() => {
    if (!wheelActiveRef.current) {
      return;
    }
    wheelActiveRef.current = false;
    wheelStateRef.current = INITIAL_FADER_WHEEL_STATE;
    latest.current.onCommit(latestValueRef.current);
  }, []);

  // Locked or disconnected mid-gesture: write what the operator had reached rather than
  // stranding it. Ownership stays put, so the rest of the gesture is ignored, not repurposed.
  useEffect(() => {
    if (disabled) {
      commitWheelGesture();
    }
  }, [disabled, commitWheelGesture]);

  useEffect(() => {
    const track = trackRef.current;
    if (track === null) {
      return;
    }
    const mine: WheelOwner = { fader: wheelId };
    const handleWheel = (event: WheelEvent) => {
      const owner = wheelGestureTracker.owner();
      if (owner !== null && !sameOwner(owner, mine)) {
        // Someone else's gesture is passing over this track: swallow it and keep theirs alive.
        wheelGestureTracker.touch();
        event.preventDefault();
        return;
      }
      if (owner === null) {
        // Shift is the escape hatch to the pager, and it only counts on the opening event.
        if (event.shiftKey) {
          return;
        }
        if (!sameOwner(wheelGestureTracker.begin(mine, commitWheelGesture), mine)) {
          wheelGestureTracker.touch();
          event.preventDefault();
          return;
        }
      }
      event.preventDefault();
      wheelGestureTracker.touch();

      const current = latest.current;
      // A locked, disconnected or dragging fader ignores the wheel outright; it never turns
      // into a page turn, so the rule does not change with the mode.
      if (current.disabled || current.dragging) {
        return;
      }
      const { state, steps } = reduceFaderWheel(wheelStateRef.current, {
        deltaY: normalizeWheelDelta(event).y,
      });
      wheelStateRef.current = state;
      if (steps === 0) {
        return;
      }
      if (!wheelActiveRef.current) {
        wheelActiveRef.current = true;
        latestValueRef.current = current.value;
        current.onInteractionStart();
      }
      const direction = steps > 0 ? 1 : -1;
      let next = latestValueRef.current;
      for (let step = 0; step < Math.abs(steps); step += 1) {
        next = stepLevelDb(next, direction, event.altKey);
      }
      latestValueRef.current = next;
      current.onValueChange(next);
    };
    track.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      track.removeEventListener('wheel', handleWheel);
    };
  }, [wheelId, commitWheelGesture]);

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
    // A wheel gesture on this fader is over the moment a hand lands on the cap.
    commitWheelGesture();
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
        data-wheel="level"
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
