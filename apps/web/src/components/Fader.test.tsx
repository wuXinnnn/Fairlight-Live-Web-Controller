import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { levelDbToRatio, ratioToLevelDb } from '../lib/fader-scale.js';
import { WHEEL_GESTURE_IDLE_MS, wheelGestureTracker } from '../lib/wheel-gesture.js';
import { Fader } from './Fader.js';

/** The gesture tracker reads `performance.now`, so that has to be faked alongside the timers. */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'performance'] as const;

function faderProps(
  overrides: Partial<ComponentProps<typeof Fader>> = {},
): ComponentProps<typeof Fader> {
  return {
    label: 'BASS',
    wheelId: 'channel/1',
    value: -20,
    onInteractionStart: vi.fn(),
    onValueChange: vi.fn(),
    onCommit: vi.fn(),
    ...overrides,
  };
}

function renderFader(overrides: Partial<ComponentProps<typeof Fader>> = {}) {
  const props = faderProps(overrides);
  render(<Fader {...props} />);
  return props;
}

function mockTrackBounds(slider: HTMLElement) {
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
}

function relativeLevel(startValue: number, startY: number, clientY: number, trackHeight = 100) {
  const nextRatio = levelDbToRatio(startValue) + (startY - clientY) / trackHeight;
  return Math.round(ratioToLevelDb(nextRatio) * 10) / 10;
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

  it('ignores track clicks and track dragging', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    mockTrackBounds(slider);

    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 100 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 100 });
    expect(props.onInteractionStart).not.toHaveBeenCalled();
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('drags the cap from the grab offset without jumping to the pointer', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    mockTrackBounds(slider);

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 30 });
    expect(props.onInteractionStart).not.toHaveBeenCalled();
    expect(props.onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 32 });
    expect(props.onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 34 });
    const expected = relativeLevel(-20, 30, 34);
    expect(expected).not.toBe(Math.round(ratioToLevelDb(1 - 34 / 100) * 10) / 10);
    expect(props.onInteractionStart).toHaveBeenCalledOnce();
    expect(props.onValueChange).toHaveBeenLastCalledWith(expected);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 34 });
    expect(props.onCommit).toHaveBeenLastCalledWith(expected);
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

  it('returns to unity on a cap double-click', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 48, detail: 2 });
    expect(props.onCommit).toHaveBeenCalledWith(0);
    fireEvent.doubleClick(cap as Element);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it('returns to unity when the cap is clicked twice without a native click count', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 48, detail: 1 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 48 });
    expect(props.onCommit).not.toHaveBeenCalled();

    fireEvent.pointerDown(cap as Element, { pointerId: 2, clientY: 48, detail: 1 });
    expect(props.onCommit).toHaveBeenCalledWith(0);
  });

  it('returns to unity from a cap double-click fallback', () => {
    const props = renderFader();
    const cap = screen.getByRole('slider', { name: 'BASS level' }).querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    fireEvent.doubleClick(cap as Element);
    expect(props.onCommit).toHaveBeenCalledWith(0);
  });

  it('does not return to unity from a track double-click', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 20, detail: 2 });
    fireEvent.doubleClick(slider);
    expect(props.onInteractionStart).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
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
      fireEvent.doubleClick(cap);
    }
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Edit BASS level' })).toBeDisabled();
  });

  it('uses the full shortened track without clamping the fader value', () => {
    const { container } = render(
      <Fader
        label="BASS"
        wheelId="channel/1"
        value={-100}
        onInteractionStart={vi.fn()}
        onValueChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(container.querySelector<HTMLElement>('.fader__cap')?.style.bottom).toBe('0%');
    expect(screen.getByLabelText('BASS level value')).toHaveTextContent('-∞');
    expect(screen.getByText('LVL')).toBeInTheDocument();
  });

  it('steps the fader with the wheel and commits once the wheel stops', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    try {
      const props = renderFader();
      const slider = screen.getByRole('slider', { name: 'BASS level' });

      // One mouse notch upwards is two 1 dB steps, applied as a single change.
      fireEvent.wheel(slider, { deltaY: -100, deltaMode: 0 });
      expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
      expect(props.onValueChange).toHaveBeenLastCalledWith(-18);
      expect(props.onCommit).not.toHaveBeenCalled();

      fireEvent.wheel(slider, { deltaY: -100, deltaMode: 0 });
      expect(props.onValueChange).toHaveBeenLastCalledWith(-16);
      // Still one gesture, so still no write.
      expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
      expect(props.onCommit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
      expect(props.onCommit).toHaveBeenCalledTimes(1);
      expect(props.onCommit).toHaveBeenCalledWith(-16);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the coarse step while Alt is held, matching PageUp', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    try {
      const props = renderFader();

      fireEvent.wheel(screen.getByRole('slider', { name: 'BASS level' }), {
        deltaY: -100,
        deltaMode: 0,
        altKey: true,
      });

      expect(props.onValueChange).toHaveBeenLastCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows the wheel while disabled rather than letting it page', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    try {
      const props = renderFader({ disabled: true });
      const slider = screen.getByRole('slider', { name: 'BASS level' });
      const event = new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });

      slider.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(props.onValueChange).not.toHaveBeenCalled();
      expect(props.onInteractionStart).not.toHaveBeenCalled();
      vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
      expect(props.onCommit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a Shift wheel to the pager without claiming it', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    try {
      const props = renderFader();
      const slider = screen.getByRole('slider', { name: 'BASS level' });
      const event = new WheelEvent('wheel', {
        deltaY: -100,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      slider.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(props.onValueChange).not.toHaveBeenCalled();
      expect(wheelGestureTracker.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits an inherited gesture when the strip that replaced it is locked', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    try {
      const first = renderFader();
      fireEvent.wheel(screen.getByRole('slider', { name: 'BASS level' }), { deltaY: -100 });
      expect(first.onValueChange).toHaveBeenLastCalledWith(-18);

      // The strip is torn down mid-gesture and rebuilt at the level it had reached — the
      // replacement has had no wheel event of its own yet when the desk is locked.
      cleanup();
      const onCommit = vi.fn();
      const replacement = (disabled: boolean) => (
        <Fader
          label="BASS"
          wheelId="channel/1"
          value={-18}
          disabled={disabled}
          onInteractionStart={vi.fn()}
          onValueChange={vi.fn()}
          onCommit={onCommit}
        />
      );
      const { rerender } = render(replacement(false));
      rerender(replacement(true));

      // Locking still has to answer for the move, and answer for it now rather than leaving it
      // to a callback belonging to a component that no longer exists.
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(-18);

      // And the gesture is now settled, so the callback still registered against the strip that
      // left must not write a second time when the wheel finally goes quiet.
      vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS * 2);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(first.onCommit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it('cancels readout editing when the cap is dragged so the draft cannot overwrite the drag', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    mockTrackBounds(slider);

    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    const input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '-5' } });

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 30 });
    fireEvent.blur(input);
    expect(screen.queryByRole('spinbutton', { name: 'BASS exact level' })).not.toBeInTheDocument();
    expect(props.onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 40 });
    const expected = relativeLevel(-20, 30, 40);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 40 });
    expect(props.onCommit).toHaveBeenCalledWith(expected);
    expect(props.onCommit).not.toHaveBeenCalledWith(-5);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it('leaves a cap to the finger that took it when a second one lands on it', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    mockTrackBounds(slider);

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 30 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 40 });
    const firstFinger = relativeLevel(-20, 30, 40);
    expect(props.onValueChange).toHaveBeenLastCalledWith(firstFinger);

    // A second finger lands on the same cap and drags a long way. It moves nothing.
    fireEvent.pointerDown(cap as Element, { pointerId: 2, clientY: 90 });
    fireEvent.pointerMove(slider, { pointerId: 2, clientY: 10 });
    expect(props.onValueChange).toHaveBeenLastCalledWith(firstFinger);
    // The fader is controlled, so the reading only moves when the value comes back down. What
    // the second finger must not do is push a value of its own out of the component.
    expect(slider).toHaveAttribute('aria-valuenow', '-20');

    // Nor does it end the drag when it lifts.
    fireEvent.pointerUp(slider, { pointerId: 2, clientY: 10 });
    expect(props.onCommit).not.toHaveBeenCalled();

    // The first finger is still dragging, and is the only one that commits.
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 50 });
    const settled = relativeLevel(-20, 30, 50);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 50 });
    expect(props.onCommit).toHaveBeenCalledExactlyOnceWith(settled);
  });

  it('does not let a second finger on a held cap read as a double tap', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    mockTrackBounds(slider);

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 30 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 40 });

    // Both shapes of the double tap: a native click count, and a second press close by inside
    // the 500 ms window. Either one sends the channel to unity if it is taken at face value.
    fireEvent.pointerDown(cap as Element, { pointerId: 2, clientY: 32, detail: 2 });
    fireEvent.pointerDown(cap as Element, { pointerId: 2, clientY: 34 });
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onValueChange).not.toHaveBeenCalledWith(0);

    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 40 });
    expect(props.onCommit).toHaveBeenCalledExactlyOnceWith(relativeLevel(-20, 30, 40));
  });

  it('takes two fingers on two faders at once and keeps the drag cursor until both are done', () => {
    const bass = { ...faderProps(), label: 'BASS', wheelId: 'channel/1' };
    const reverb = {
      ...faderProps(),
      label: 'MIC-REVERB',
      wheelId: 'channel/2',
      value: -10,
    };
    render(
      <>
        <Fader {...bass} />
        <Fader {...reverb} />
      </>,
    );
    const bassTrack = screen.getByRole('slider', { name: 'BASS level' });
    const reverbTrack = screen.getByRole('slider', { name: 'MIC-REVERB level' });
    mockTrackBounds(bassTrack);
    mockTrackBounds(reverbTrack);

    fireEvent.pointerDown(bassTrack.querySelector('.fader__cap') as Element, {
      pointerId: 1,
      clientY: 30,
    });
    fireEvent.pointerDown(reverbTrack.querySelector('.fader__cap') as Element, {
      pointerId: 2,
      clientY: 60,
    });
    expect(document.documentElement).toHaveClass('fader-cap-dragging');

    // Interleaved, the way two hands actually move.
    fireEvent.pointerMove(bassTrack, { pointerId: 1, clientY: 40 });
    fireEvent.pointerMove(reverbTrack, { pointerId: 2, clientY: 50 });
    fireEvent.pointerMove(bassTrack, { pointerId: 1, clientY: 45 });
    const bassValue = relativeLevel(-20, 30, 45);
    const reverbValue = relativeLevel(-10, 60, 50);
    expect(bass.onValueChange).toHaveBeenLastCalledWith(bassValue);
    expect(reverb.onValueChange).toHaveBeenLastCalledWith(reverbValue);
    expect(bass.onValueChange).not.toHaveBeenCalledWith(reverbValue);
    expect(reverb.onValueChange).not.toHaveBeenCalledWith(bassValue);

    // The first hand to finish must not take the cursor off the other one's drag.
    fireEvent.pointerUp(bassTrack, { pointerId: 1, clientY: 45 });
    expect(bass.onCommit).toHaveBeenCalledExactlyOnceWith(bassValue);
    expect(reverb.onCommit).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveClass('fader-cap-dragging');

    fireEvent.pointerUp(reverbTrack, { pointerId: 2, clientY: 50 });
    expect(reverb.onCommit).toHaveBeenCalledExactlyOnceWith(reverbValue);
    expect(document.documentElement).not.toHaveClass('fader-cap-dragging');
  });

  it('gives up the drag cursor when a fader is unmounted mid-drag', () => {
    const { unmount } = render(<Fader {...faderProps()} />);
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    mockTrackBounds(slider);

    fireEvent.pointerDown(slider.querySelector('.fader__cap') as Element, {
      pointerId: 1,
      clientY: 30,
    });
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 40 });
    expect(document.documentElement).toHaveClass('fader-cap-dragging');

    // A strip can go while a finger is still on it: the view changes, or the page turns.
    unmount();
    expect(document.documentElement).not.toHaveClass('fader-cap-dragging');
  });

  it('starts a new drag after a press and release too quick for React to have rendered', () => {
    const props = renderFader();
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    mockTrackBounds(slider);

    // Down and up inside one batch, so `dragging` is never true for the release to see. The cap
    // still has to be free afterwards, or the fader is dead for the rest of the show.
    act(() => {
      fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 30 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientY: 30 });
    });

    fireEvent.pointerDown(cap as Element, { pointerId: 2, clientY: 50 });
    fireEvent.pointerMove(slider, { pointerId: 2, clientY: 60 });
    const expected = relativeLevel(-20, 50, 60);
    expect(props.onValueChange).toHaveBeenLastCalledWith(expected);
    fireEvent.pointerUp(slider, { pointerId: 2, clientY: 60 });
    expect(props.onCommit).toHaveBeenLastCalledWith(expected);
  });
});
