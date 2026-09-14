import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import {
  PAGE_PADDING_X_PX,
  STRIP_GAP_PX,
  STRIP_WIDTH_PX,
} from '../src/features/mixer/page-layout.js';
import { PAGE_WHEEL_THRESHOLD_PX } from '../src/lib/page-wheel.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { resizePager } from './stub-mixer-layout.js';

/** The level sender throttles on `performance`, and the pager reads the same clock. */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'];

/** Comfortably over the travel a page costs, so one move would be one page if it counted. */
const SWIPE_PX = PAGE_WHEEL_THRESHOLD_PX + 10;

const snapshot: MixerSnapshot = {
  channels: Array.from({ length: 6 }, (_, index) => ({
    id: `channel/${index + 1}`,
    kind: 'channel' as const,
    name: `IN-${index + 1}`,
    levelDb: -20,
    muted: false,
    meterDb: -30,
  })),
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connected',
};

/** Two strips to a page, so the two faders under test are on screen together. */
const PAGE_WIDTH = 2 * STRIP_WIDTH_PX + STRIP_GAP_PX + 2 * PAGE_PADDING_X_PX;

function mount() {
  const socket = new FakeSocket();
  render(<App socket={socket} />);
  act(() => {
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  });
  act(() => {
    vi.advanceTimersByTime(1);
  });
  resizePager(PAGE_WIDTH);
  return socket;
}

const track = (name: string) => screen.getByRole('slider', { name: `${name} level` });
const capOf = (name: string): Element => {
  const cap = track(name).querySelector('.fader__cap');
  if (cap === null) {
    throw new Error(`no cap on ${name}`);
  }
  return cap;
};
const page = () => screen.getByLabelText('Page').textContent;
const deck = (): Element => {
  const node = document.querySelector('.mixer-deck');
  if (node === null) {
    throw new Error('the deck is not rendered');
  }
  return node;
};

/** jsdom has no `Touch` constructor, but its touch events take plain touch-shaped objects. */
function touchList(target: Element, ys: number[]) {
  return ys.map((clientY, identifier) => ({
    identifier,
    target,
    clientX: 10,
    clientY,
    pageX: 10,
    pageY: clientY,
  }));
}

/** The levels this socket was asked for, in order, for one channel. */
function levelsSentFor(socket: FakeSocket, id: string): number[] {
  return socket.emitted
    .filter((entry) => entry.event === SOCKET_EVENTS.CONTROL_SET_LEVEL)
    .map((entry) => entry.args[0] as { id: string; levelDb: number })
    .filter((command) => command.id === id)
    .map((command) => command.levelDb);
}

/**
 * Two hands on two faders is the ordinary way this desk is played, and the strips are a finger's
 * width apart. These cases hold down that the two drags stay separate, and that the pager keeps
 * out of it: a second finger anywhere on the deck is not a page turn.
 */
describe('two fingers on the mixer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: FAKE_TIMERS as never });
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives two faders at once without either one reaching the other', () => {
    const socket = mount();
    const first = track('IN-1');
    const second = track('IN-2');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 100) as unknown as DOMRect,
    );
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 100) as unknown as DOMRect,
    );

    fireEvent.pointerDown(capOf('IN-1'), { pointerId: 1, clientY: 60 });
    fireEvent.pointerDown(capOf('IN-2'), { pointerId: 2, clientY: 60 });

    // Interleaved, one hand pushing up while the other pulls down, with enough time between
    // moves that the 50 ms throttle lets every step through.
    fireEvent.pointerMove(first, { pointerId: 1, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    fireEvent.pointerMove(second, { pointerId: 2, clientY: 70 });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    fireEvent.pointerUp(first, { pointerId: 1, clientY: 50 });
    fireEvent.pointerUp(second, { pointerId: 2, clientY: 70 });

    const firstLevels = levelsSentFor(socket, 'channel/1');
    const secondLevels = levelsSentFor(socket, 'channel/2');
    expect(firstLevels.length).toBeGreaterThan(0);
    expect(secondLevels.length).toBeGreaterThan(0);
    // The hand that went up only ever asked for more level, and the other only for less.
    expect(firstLevels.every((level) => level > -20)).toBe(true);
    expect(secondLevels.every((level) => level < -20)).toBe(true);
  });

  it('stays on the same page while two fingers are working the faders', () => {
    mount();
    expect(page()).toBe('1 / 3');
    const first = track('IN-1');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 100) as unknown as DOMRect,
    );

    fireEvent.pointerDown(capOf('IN-1'), { pointerId: 1, clientY: 400 });
    fireEvent.pointerDown(capOf('IN-2'), { pointerId: 2, clientY: 400 });

    // The same travel as a page-turning swipe, but with two fingers down on the deck. The pager
    // only ever listens to one, and neither of these belongs to it.
    const down = touchList(deck(), [400, 400]);
    act(() => {
      fireEvent.touchStart(deck(), { touches: down, targetTouches: down, changedTouches: down });
    });
    const moved = touchList(deck(), [400 - SWIPE_PX, 400 - SWIPE_PX]);
    act(() => {
      fireEvent.touchMove(deck(), { touches: moved, targetTouches: moved, changedTouches: moved });
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(page()).toBe('1 / 3');
    fireEvent.pointerUp(first, { pointerId: 1, clientY: 400 - SWIPE_PX });
    expect(page()).toBe('1 / 3');
  });
});
