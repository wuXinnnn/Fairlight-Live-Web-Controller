import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnButton } from './OnButton.js';

describe('OnButton', () => {
  it('renders the inverted mute presentation and emits the next ON state', () => {
    const onToggle = vi.fn();
    render(<OnButton label="BASS" on={true} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'BASS on' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('blocks interaction while disabled or pending', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<OnButton label="BASS" on={false} disabled onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'BASS off' }));
    expect(onToggle).not.toHaveBeenCalled();

    rerender(<OnButton label="BASS" on={false} pending onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'BASS off' })).toBeDisabled();
  });
});
