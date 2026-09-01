import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlLock } from './ControlLock.js';
import {
  CONTROL_LOCK_STORAGE_KEY,
  readControlLockPreference,
  useControlLockPreference,
  type ControlLockMode,
} from './use-control-lock-preference.js';

describe('ControlLock', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('selects any lock mode directly', () => {
    const onChange = vi.fn();
    render(<ControlLock mode="unlocked" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'UNLOCKED' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'ALL' }));
    expect(onChange).toHaveBeenCalledWith('all');
    fireEvent.click(screen.getByRole('radio', { name: 'FADERS' }));
    expect(onChange).toHaveBeenCalledWith('faders');
  });

  it('defaults safely and persists the selected mode', () => {
    window.localStorage.setItem(CONTROL_LOCK_STORAGE_KEY, 'invalid');
    expect(readControlLockPreference(window.localStorage)).toBe('unlocked');

    const { result } = renderHook(() => useControlLockPreference());
    act(() => {
      result.current[1]('faders');
    });
    expect(result.current[0]).toBe('faders');
    expect(window.localStorage.getItem(CONTROL_LOCK_STORAGE_KEY)).toBe('faders');

    const restored = renderHook(() => useControlLockPreference());
    expect(restored.result.current[0]).toBe('faders');
  });

  it.each<ControlLockMode>(['unlocked', 'faders', 'all'])('reads the stored %s mode', (mode) => {
    window.localStorage.setItem(CONTROL_LOCK_STORAGE_KEY, mode);
    expect(readControlLockPreference(window.localStorage)).toBe(mode);
  });
});
