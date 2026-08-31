import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Fader } from './Fader.js';

function renderFader(overrides: Partial<ComponentProps<typeof Fader>> = {}) {
  const props: ComponentProps<typeof Fader> = {
    label: 'BASS',
    value: -20,
    onInteractionStart: vi.fn(),
    onValueChange: vi.fn(),
    onCommit: vi.fn(),
    ...overrides,
  };
  render(<Fader {...props} />);
  return props;
}

describe('Fader', () => {
  it('exposes the current value and applies keyboard steps', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    expect(slider).toHaveAttribute('aria-valuetext', '-20.0 dB');

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(props.onValueChange).toHaveBeenCalledWith(-19);
    expect(props.onCommit).toHaveBeenCalledWith(-19);

    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(props.onCommit).toHaveBeenLastCalledWith(-30);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(props.onCommit).toHaveBeenLastCalledWith(-100);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(props.onCommit).toHaveBeenLastCalledWith(10);
  });

  it('supports track jumps and pointer dragging', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 40,
      bottom: 100,
      width: 40,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 0 });
    expect(props.onInteractionStart).toHaveBeenCalled();
    expect(props.onValueChange).toHaveBeenLastCalledWith(10);
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 100 });
    expect(props.onValueChange).toHaveBeenLastCalledWith(-100);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 100 });
    expect(props.onCommit).toHaveBeenLastCalledWith(-100);
  });

  it('disables pointer and keyboard interaction while unavailable', () => {
    const props = renderFader({ disabled: true });
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 10 });
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-disabled', 'true');
  });
});
