import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TypeRowToggle } from './TypeRowToggle.js';
import {
  TYPE_ROWS_STORAGE_KEY,
  readTypeRowsPreference,
  useTypeRowsPreference,
} from './use-type-row-preference.js';

describe('type row preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to mixed flow and persists the enabled state', () => {
    expect(readTypeRowsPreference(window.localStorage)).toBe(false);
    const { result } = renderHook(() => useTypeRowsPreference());
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(TYPE_ROWS_STORAGE_KEY)).toBe('true');

    const restored = renderHook(() => useTypeRowsPreference());
    expect(restored.result.current[0]).toBe(true);
  });

  it('renders an English switch with the current state', () => {
    let toggles = 0;
    const onToggle = () => {
      toggles += 1;
    };
    const { rerender } = render(<TypeRowToggle enabled={false} onToggle={onToggle} />);
    expect(screen.getByText('TYPE ROWS')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Start each channel type on a new row' }),
    ).toHaveAttribute('aria-checked', 'false');

    rerender(<TypeRowToggle enabled onToggle={onToggle} />);
    expect(
      screen.getByRole('switch', { name: 'Start each channel type on a new row' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch'));
    expect(toggles).toBe(1);
  });
});
