import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import {
  SECTION_HEADER_WIDTH_PX,
  STRIP_GAP_PX,
  STRIP_WIDTH_PX,
} from '../src/features/mixer/page-layout.js';
import { WHEEL_GESTURE_IDLE_MS } from '../src/lib/wheel-gesture.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { resizePager } from './stub-mixer-layout.js';

/** Faking `performance` too: the gesture tracker and the page reducer both read the clock. */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'];

/** One notch of a typical mouse wheel in Chrome. */
const NOTCH_PX = 100;

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

/** Two strips to a page, so there are three pages and a neighbour always stays mounted. */
const PAGE_WIDTH = SECTION_HEADER_WIDTH_PX + 2 * (STRIP_GAP_PX + STRIP_WIDTH_PX);

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

interface WheelOptions {
  deltaY?: number;
  deltaX?: number;
  deltaMode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Dispatches a real wheel event so `preventDefault` can be observed. */
function wheel(target: Element, options: WheelOptions = {}): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: options.deltaY ?? NOTCH_PX,
    deltaX: options.deltaX ?? 0,
    deltaMode: options.deltaMode ?? 0,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * Lets the 50 ms level throttle fire without ending the gesture, so a later `settle` produces
 * the commit and nothing else.
 */
function flushThrottle() {
  act(() => {
    vi.advanceTimersByTime(60);
  });
}

/** Lets the gesture fall silent, which is what makes a fader write its value. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS * 2);
  });
}

const track = (name: string) => screen.getByRole('slider', { name: `${name} level` });
const levelOf = (name: string) => track(name).getAttribute('aria-valuenow');
const page = () => screen.getByLabelText('Page').textContent;
const blankArea = (): Element => {
  const area = document.querySelector('.mixer-page');
  if (area === null) {
    throw new Error('no page is rendered');
  }
  return area;
};
const levelWrites = (socket: FakeSocket) =>
  socket.emitted.filter(({ event }) => event === SOCKET_EVENTS.CONTROL_SET_LEVEL);

describe('wheel ownership between faders and the pager', () => {
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

  it('1. moves the fader under the pointer and writes once when the wheel stops', () => {
    const { socket } = mount();

    for (let notch = 0; notch < 3; notch += 1) {
      expect(wheel(track('IN-1')).defaultPrevented).toBe(true);
    }

    // Three notches down at two 1 dB steps each, and the page has not moved.
    expect(levelOf('IN-1')).toBe('-26');
    expect(page()).toMatch(/^1 \//);
    // The strip throttles: three notches are not three writes.
    expect(levelWrites(socket).length).toBeLessThan(3);

    flushThrottle();
    const beforeSettling = levelWrites(socket).length;
    settle();
    const writes = levelWrites(socket);
    expect(writes.length).toBe(beforeSettling + 1);
    expect(writes.at(-1)?.args[0]).toEqual({ id: 'channel/1', levelDb: -26 });
  });

  it('2. keeps the gesture on its fader when the pointer wanders off the track', () => {
    const { socket } = mount();
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-22');

    // Off the track: neither the fader nor the pager may act on this.
    expect(wheel(blankArea()).defaultPrevented).toBe(true);
    expect(levelOf('IN-1')).toBe('-22');
    expect(page()).toMatch(/^1 \//);

    // Back on the track before the gesture ends: the same fader carries on.
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-24');

    flushThrottle();
    const beforeSettling = levelWrites(socket).length;
    settle();
    // One commit for the whole gesture, however far the pointer strayed.
    expect(levelWrites(socket).length).toBe(beforeSettling + 1);
    expect(levelWrites(socket).at(-1)?.args[0]).toEqual({ id: 'channel/1', levelDb: -24 });
  });

  it('3. keeps a paging gesture off the faders it slides under the pointer', () => {
    mount();

    wheel(blankArea());
    expect(page()).toMatch(/^2 \//);

    // The tail of the flick lands on a fader that the page turn moved under the pointer.
    for (let event = 0; event < 6; event += 1) {
      const decaying = 20 - event * 3;
      expect(wheel(track('IN-3'), { deltaY: decaying }).defaultPrevented).toBe(true);
    }
    expect(levelOf('IN-3')).toBe('-20');
    expect(page()).toMatch(/^2 \//);
  });

  it('4. never lets a second fader join a gesture that belongs to the first', () => {
    const { socket } = mount();
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-22');

    wheel(track('IN-2'));
    wheel(track('IN-2'));
    expect(levelOf('IN-2')).toBe('-20');

    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-24');

    flushThrottle();
    const beforeSettling = levelWrites(socket).length;
    settle();
    const writes = levelWrites(socket).map(({ args }) => args[0] as { id: string });
    expect(levelWrites(socket).length).toBe(beforeSettling + 1);
    expect(writes.every((write) => write.id === 'channel/1')).toBe(true);
    expect(writes.at(-1)).toEqual({ id: 'channel/1', levelDb: -24 });
  });

  it('5. reads Shift only on the opening event of a gesture', () => {
    mount();

    // Shift on the track is the escape hatch to the pager.
    wheel(track('IN-1'), { shiftKey: true });
    expect(page()).toMatch(/^2 \//);
    expect(levelOf('IN-1')).toBe('-20');

    // Releasing Shift mid-flick does not hand the gesture to the fader.
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-20');
    settle();

    // A gesture that opened without Shift keeps the fader even once Shift goes down.
    wheel(track('IN-3'));
    expect(levelOf('IN-3')).toBe('-22');
    wheel(track('IN-3'), { shiftKey: true });
    expect(levelOf('IN-3')).toBe('-24');
    expect(page()).toMatch(/^2 \//);
  });

  it('6. writes what the operator reached when the fader locks mid-gesture', () => {
    const { socket } = mount();
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-22');
    flushThrottle();

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: 'FADERS' }));
    });
    const afterLocking = levelWrites(socket);
    expect(afterLocking.at(-1)?.args[0]).toEqual({ id: 'channel/1', levelDb: -22 });

    // The rest of the gesture moves nothing at all.
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-22');
    expect(page()).toMatch(/^1 \//);

    // And the gesture ending does not write a second time.
    settle();
    expect(levelWrites(socket).length).toBe(afterLocking.length);
  });

  it('7. ignores the wheel on a locked fader instead of turning the page', () => {
    const { socket } = mount();
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: 'FADERS' }));
    });

    expect(wheel(track('IN-1')).defaultPrevented).toBe(true);

    expect(levelOf('IN-1')).toBe('-20');
    expect(page()).toMatch(/^1 \//);
    expect(levelWrites(socket)).toHaveLength(0);
    settle();
    expect(levelWrites(socket)).toHaveLength(0);
  });

  it('8. turns the page from every surface that is not a fader track', () => {
    mount();
    const strip = track('IN-1').closest('article');
    const surfaces: Array<[string, Element | null | undefined]> = [
      ['channel name', strip?.querySelector('h3')],
      ['ON button', strip?.querySelector('.on-button')],
      ['meter', screen.getByLabelText('IN-1 meter')],
      ['level readout', screen.getByLabelText('IN-1 level value')],
      ['section header', document.querySelector('.mixer-section__header')],
      ['page rail', screen.getByRole('complementary', { name: 'Pages' })],
    ];

    surfaces.forEach(([name, surface], index) => {
      expect(surface, name).toBeTruthy();
      const before = page();
      // Alternate direction so the pager ping-pongs instead of parking on the last page.
      wheel(surface as Element, { deltaY: index % 2 === 0 ? NOTCH_PX : -NOTCH_PX });
      expect(page(), name).not.toBe(before);
      // Each surface starts a gesture of its own, so let the previous one lapse.
      settle();
    });
  });

  it('9. scrolls a viewport too short for a page instead of turning it', () => {
    mount();
    // The page no longer fits: scrolling has to reach the rest of the strip first.
    resizePager(PAGE_WIDTH, 300, 600);

    const scrolled = wheel(blankArea());
    expect(scrolled.defaultPrevented).toBe(false);
    expect(page()).toMatch(/^1 \//);
    settle();

    // The faders still take the wheel on their own tracks.
    wheel(track('IN-1'));
    expect(levelOf('IN-1')).toBe('-22');
  });
});
