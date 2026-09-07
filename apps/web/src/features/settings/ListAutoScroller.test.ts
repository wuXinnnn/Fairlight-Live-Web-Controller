import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SCROLL_REMEASURE_MS } from './dnd-config.js';
import type { Point } from './drag-preview.js';
import { createScroller } from './ListAutoScroller.js';

function fakeList(max: number, top = 100, bottom = 500): HTMLElement {
  let scrollTop = 0;
  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = Math.max(0, Math.min(max, value));
    },
    getBoundingClientRect: () => ({ top, bottom }),
  } as unknown as HTMLElement;
}

describe('createScroller', () => {
  const frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frames.length = 0;
    now = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const flush = () => {
    const queued = frames.splice(0, frames.length);
    for (const frame of queued) {
      frame(now);
    }
  };

  it('scrolls by the edge step every frame and re-measures at most once per interval', () => {
    const list = fakeList(1000);
    const pointer: { current: Point | null } = { current: { x: 10, y: 500 } };
    const remeasure = vi.fn();
    const scroller = createScroller({ current: list }, pointer, { current: remeasure }, () => 900);
    scroller.start();
    scroller.start();
    expect(frames).toHaveLength(1);
    flush();
    expect(list.scrollTop).toBe(12);
    expect(remeasure).toHaveBeenCalledTimes(1);
    now = AUTO_SCROLL_REMEASURE_MS / 2;
    flush();
    expect(list.scrollTop).toBe(24);
    expect(remeasure).toHaveBeenCalledTimes(1);
    now = AUTO_SCROLL_REMEASURE_MS;
    flush();
    expect(list.scrollTop).toBe(36);
    expect(remeasure).toHaveBeenCalledTimes(2);

    pointer.current = { x: 10, y: 100 };
    flush();
    expect(list.scrollTop).toBe(24);
    pointer.current = { x: 10, y: 300 };
    flush();
    expect(list.scrollTop).toBe(24);
    pointer.current = null;
    flush();
    expect(list.scrollTop).toBe(24);
    expect(frames).toHaveLength(1);
    scroller.stop();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('clamps the edge zone to the viewport and keeps polling at the end of the list', () => {
    const list = fakeList(10, 100, 1200);
    const pointer = { current: { x: 10, y: 844 } };
    const remeasure = vi.fn();
    const scroller = createScroller({ current: list }, pointer, { current: remeasure }, () => 844);
    scroller.start();
    flush();
    expect(list.scrollTop).toBe(10);
    now = 500;
    flush();
    expect(list.scrollTop).toBe(10);
    expect(remeasure).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
  });

  it('stops when the list is gone', () => {
    const remeasure = vi.fn();
    const scroller = createScroller(
      { current: null },
      { current: { x: 0, y: 0 } },
      { current: remeasure },
    );
    scroller.start();
    flush();
    expect(frames).toHaveLength(0);
    expect(remeasure).not.toHaveBeenCalled();
  });
});
