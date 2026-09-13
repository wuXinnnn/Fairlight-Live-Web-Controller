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
import { resizePager, scrollPage } from './stub-mixer-layout.js';

/** Faking `performance` too: the page reducer reads that clock for its cooldown. */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'];

/** Comfortably over the travel a page costs, so one move is one page. */
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

/** Two strips to a page, so there are three pages to drag between. */
const PAGE_WIDTH = 2 * STRIP_WIDTH_PX + STRIP_GAP_PX + 2 * PAGE_PADDING_X_PX;

function mount() {
  const socket = new FakeSocket();
  const rendered = render(<App socket={socket} />);
  act(() => {
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  });
  act(() => {
    vi.advanceTimersByTime(1);
  });
  resizePager(PAGE_WIDTH);
  return { socket, ...rendered };
}

/** jsdom has no `Touch` constructor, but its touch events take plain touch-shaped objects. */
function touches(target: Element, y: number, fingers = 1) {
  return Array.from({ length: fingers }, (_, identifier) => ({
    identifier,
    target,
    clientX: 10,
    clientY: y,
    pageX: 10,
    pageY: y,
  }));
}

function touchStart(target: Element, y: number, fingers = 1): void {
  const list = touches(target, y, fingers);
  act(() => {
    fireEvent.touchStart(target, { touches: list, targetTouches: list, changedTouches: list });
  });
}

function touchMove(target: Element, y: number, fingers = 1): void {
  const list = touches(target, y, fingers);
  act(() => {
    fireEvent.touchMove(target, { touches: list, targetTouches: list, changedTouches: list });
  });
  // Let the clock move the way it does between two frames of a real drag.
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

/** Returns whether the touch was left alone, the way a synthesised click needs it to be. */
function touchEnd(target: Element, y: number): boolean {
  const list = touches(target, y);
  let allowed = true;
  act(() => {
    allowed = fireEvent.touchEnd(target, { touches: [], targetTouches: [], changedTouches: list });
  });
  return allowed;
}

const page = () => screen.getByLabelText('Page').textContent;
const rail = () => screen.getByRole('complementary', { name: 'Pages' });
const track = (name: string) => screen.getByRole('slider', { name: `${name} level` });
const strips = (): Element => {
  const area = document.querySelector('.mixer-page');
  if (area === null) {
    throw new Error('no page is rendered');
  }
  return area;
};

/** Drags a finger up (towards the next page) or down over `surface` by `travel` pixels. */
function drag(surface: Element, travel: number): boolean {
  const from = 400;
  touchStart(surface, from);
  touchMove(surface, from - travel);
  return touchEnd(surface, from - travel);
}

describe('turning pages with a finger', () => {
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

  it('turns the page when a finger drags up the rail', () => {
    mount();
    expect(page()).toBe('1 / 3');

    drag(rail(), SWIPE_PX);

    expect(page()).toBe('2 / 3');
  });

  it('goes back when the finger drags the other way', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(page()).toBe('2 / 3');

    drag(rail(), -SWIPE_PX);

    expect(page()).toBe('1 / 3');
  });

  it('drags the rail into the next page even while the strips beside it scroll', () => {
    mount();
    // The page is taller than the viewport, so the strips scroll. Nothing under the rail does.
    resizePager(PAGE_WIDTH, 300, 600);

    drag(rail(), SWIPE_PX);

    expect(page()).toBe('2 / 3');
  });

  it('scrolls the strips to the end before it turns them', () => {
    mount();
    resizePager(PAGE_WIDTH, 300, 600);

    // Part way down the page: the rest of the strip comes first, and the travel is the browser's.
    drag(strips(), SWIPE_PX);
    expect(page()).toBe('1 / 3');

    scrollPage(300);
    drag(strips(), SWIPE_PX);
    expect(page()).toBe('2 / 3');
  });

  it('turns the page from the strips when there is nothing left to scroll', () => {
    mount();

    drag(strips(), SWIPE_PX);

    expect(page()).toBe('2 / 3');
  });

  it('leaves a finger that lands on a fader to the fader', () => {
    mount();

    drag(track('IN-1'), SWIPE_PX);

    expect(page()).toBe('1 / 3');
    expect(track('IN-1').getAttribute('aria-valuenow')).toBe('-20');
  });

  it('does not press what a page-turning drag ends on', () => {
    mount();

    // A drag that turned a page: the two page keys and the ON button are all a finger's width
    // from the empty rail, and none of them may be pressed by a gesture that meant the page.
    expect(drag(rail(), SWIPE_PX)).toBe(false);
    expect(page()).toBe('2 / 3');

    // A tap that turned nothing is still a tap.
    touchStart(rail(), 400);
    expect(touchEnd(rail(), 400)).toBe(true);
  });

  it('ignores anything that is not one finger', () => {
    mount();

    // Two fingers down: not a page turn, and not one either when one of them lifts part way
    // through and the drag that is left looks like a very long swipe.
    touchStart(rail(), 400, 2);
    touchMove(rail(), 400 - SWIPE_PX, 2);
    touchMove(rail(), 400 - 2 * SWIPE_PX);
    touchEnd(rail(), 400 - 2 * SWIPE_PX);
    expect(page()).toBe('1 / 3');

    // A second finger joining a drag that had started alone stops it just the same.
    touchStart(rail(), 400);
    touchMove(rail(), 400 - SWIPE_PX, 2);
    touchEnd(rail(), 400 - SWIPE_PX);
    expect(page()).toBe('1 / 3');
  });
});
