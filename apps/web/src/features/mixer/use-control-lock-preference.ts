import { useState } from 'react';

export const CONTROL_LOCK_STORAGE_KEY = 'flwc.controls.lockMode.v1';
export const CONTROL_LOCK_MODES = ['unlocked', 'faders', 'all'] as const;
export type ControlLockMode = (typeof CONTROL_LOCK_MODES)[number];

export function readControlLockPreference(storage: Pick<Storage, 'getItem'>): ControlLockMode {
  const stored = storage.getItem(CONTROL_LOCK_STORAGE_KEY);
  return CONTROL_LOCK_MODES.find((mode) => mode === stored) ?? 'unlocked';
}

export function useControlLockPreference(): [ControlLockMode, (mode: ControlLockMode) => void] {
  const [mode, setMode] = useState<ControlLockMode>(() => {
    try {
      return readControlLockPreference(window.localStorage);
    } catch (error) {
      console.warn('Unable to read the control lock preference.', error);
      return 'unlocked';
    }
  });

  const updateMode = (nextMode: ControlLockMode) => {
    setMode(nextMode);
    try {
      window.localStorage.setItem(CONTROL_LOCK_STORAGE_KEY, nextMode);
    } catch (error) {
      console.warn('Unable to save the control lock preference.', error);
    }
  };

  return [mode, updateMode];
}
