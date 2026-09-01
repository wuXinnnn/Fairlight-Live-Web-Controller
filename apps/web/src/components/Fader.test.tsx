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

  it('grabs the cap without jumping until the pointer actually moves', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
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

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 48 });
    expect(props.onInteractionStart).not.toHaveBeenCalled();
    expect(props.onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 49 });
    expect(props.onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 52 });
    expect(props.onInteractionStart).toHaveBeenCalledOnce();
    expect(props.onValueChange).toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 52 });
    expect(props.onCommit).toHaveBeenCalled();
  });

  it('does not commit when the cap is clicked without dragging', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 48 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 48 });
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('returns to unity on a track double-click', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 20, detail: 2 });
    expect(props.onCommit).toHaveBeenCalledWith(0);
    fireEvent.doubleClick(slider);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it('returns to unity from a double-click fallback', () => {
    const props = renderFader();
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'BASS level' }));
    expect(props.onCommit).toHaveBeenCalledWith(0);
  });

  it('disables pointer and keyboard interaction while unavailable', () => {
    const props = renderFader({ disabled: true });
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 10 });
    fireEvent.doubleClick(slider);
    const cap = slider.querySelector('.fader__cap');
    if (cap !== null) {
      fireEvent.pointerDown(cap, { pointerId: 2, clientY: 10 });
      fireEvent.pointerMove(slider, { pointerId: 2, clientY: 40 });
    }
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Edit BASS level' })).toBeDisabled();
  });

  it('uses the full shortened track without clamping the fader value', () => {
    const { container } = render(
      <Fader
        label="BASS"
        value={-100}
        onInteractionStart={vi.fn()}
        onValueChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(container.querySelector<HTMLElement>('.fader__cap')?.style.bottom).toBe('0%');
    expect(screen.getByLabelText('BASS level value')).toHaveTextContent('-∞');
    expect(screen.queryByText('LVL')).not.toBeInTheDocument();
  });

  it('edits and commits a precise level value', () => {
    const props = renderFader();
    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    const input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    expect(input).toHaveValue(-20);
    fireEvent.change(input, { target: { value: '-12.3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onInteractionStart).toHaveBeenCalledOnce();
    expect(props.onValueChange).toHaveBeenCalledWith(-12.3);
    expect(props.onCommit).toHaveBeenCalledWith(-12.3);
    expect(screen.getByRole('button', { name: 'Edit BASS level' })).toBeInTheDocument();
  });

  it('keeps invalid input open until Escape cancels it', () => {
    const props = renderFader();
    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    const input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '11' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(props.onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('commits valid input and cancels invalid input on blur', () => {
    const props = renderFader();
    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    let input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '-8.5' } });
    fireEvent.blur(input);
    expect(props.onCommit).toHaveBeenCalledWith(-8.5);

    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(props.onCommit).toHaveBeenCalledOnce();
  });
});
