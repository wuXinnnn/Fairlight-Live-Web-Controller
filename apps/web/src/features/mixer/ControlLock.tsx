import { CONTROL_LOCK_MODES, type ControlLockMode } from './use-control-lock-preference.js';

const LOCK_LABELS: Record<ControlLockMode, string> = {
  unlocked: 'UNLOCKED',
  faders: 'FADERS',
  all: 'ALL',
};

interface ControlLockProps {
  mode: ControlLockMode;
  onChange(mode: ControlLockMode): void;
}

export function ControlLock({ mode, onChange }: ControlLockProps) {
  return (
    <fieldset className="control-lock">
      <legend>CONTROL LOCK</legend>
      <div className="control-lock__options">
        {CONTROL_LOCK_MODES.map((option) => (
          <button
            type="button"
            role="radio"
            aria-checked={mode === option}
            className={mode === option ? 'is-selected' : ''}
            key={option}
            onClick={() => {
              onChange(option);
            }}
          >
            {LOCK_LABELS[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
