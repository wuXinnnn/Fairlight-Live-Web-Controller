import { act, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLIP_CLEANUP_FALLBACK_MS,
  FLIP_TRANSITION,
  useFlipList,
  type FlipListHandle,
} from './use-flip-list.js';

interface Item {
  key: string;
  members?: string[];
}

/** Positions by flip key; the layout stub reads them so tests can move elements. */
const tops = new Map<string, number>();
const frames: FrameRequestCallback[] = [];
let handle: FlipListHandle | null = null;

function Harness({ items, dependency }: { items: Item[]; dependency: unknown }) {
  const listRef = useRef<HTMLOListElement>(null);
  const flip = useFlipList(listRef, dependency);
  useEffect(() => {
    handle = flip;
  }, [flip]);
  return (
    <ol ref={listRef}>
      {items.map((item) => (
        <li key={item.key} data-flip-key={item.key}>
          {item.members?.map((member) => (
            <div key={member} data-flip-key={member} />
          ))}
        </li>
      ))}
    </ol>
  );
}

function rectFor(element: Element): DOMRect {
  const top = tops.get(element.getAttribute('data-flip-key') ?? '') ?? 0;
  return { top, left: 0, width: 100, height: 40, bottom: top + 40, right: 100 } as DOMRect;
}

function harness(props: { items: Item[]; dependency: unknown }) {
  return <Harness {...props} />;
}

function element(key: string): HTMLElement {
  return document.querySelector(`[data-flip-key="${key}"]`) as HTMLElement;
}

function flushFrames(): void {
  const queued = frames.splice(0, frames.length);
  for (const frame of queued) {
    frame(0);
  }
}

describe('useFlipList', () => {
  beforeEach(() => {
    tops.clear();
    frames.length = 0;
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return rectFor(this);
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    handle = null;
  });

  it('applies the inverse transform, releases it on the next frame and cleans up', () => {
    tops.set('a', 0).set('b', 40);
    const view = render(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 1 }));
    tops.set('a', 40).set('b', 0);
    view.rerender(harness({ items: [{ key: 'b' }, { key: 'a' }], dependency: 2 }));

    expect(element('a').style.transform).toBe('translate(0px, -40px)');
    expect(element('a').style.transition).toBe('none');
    expect(element('b').style.transform).toBe('translate(0px, 40px)');

    act(() => flushFrames());
    expect(element('a').style.transform).toBe('');
    expect(element('a').style.transition).toBe(FLIP_TRANSITION);

    const ended = new Event('transitionend', { bubbles: true }) as TransitionEvent;
    Object.defineProperty(ended, 'propertyName', { value: 'transform' });
    act(() => {
      element('a').dispatchEvent(ended);
    });
    expect(element('a').style.transition).toBe('');
    expect(element('b').style.transition).toBe(FLIP_TRANSITION);

    act(() => {
      vi.advanceTimersByTime(FLIP_CLEANUP_FALLBACK_MS);
    });
    expect(element('b').style.transition).toBe('');
  });

  it('ignores movements under one pixel and elements that just appeared', () => {
    tops.set('a', 0).set('b', 40);
    const view = render(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 1 }));
    tops.set('a', 0.5).set('c', 80);
    view.rerender(harness({ items: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], dependency: 2 }));
    expect(element('a').style.transform).toBe('');
    expect(element('b').style.transform).toBe('');
    expect(element('c').style.transform).toBe('');
    expect(frames).toHaveLength(0);
  });

  it('animates members relative to their moving group block', () => {
    tops.set('g', 0).set('m1', 40).set('m2', 80).set('x', 120);
    const view = render(
      harness({
        items: [{ key: 'g', members: ['m1', 'm2'] }, { key: 'x' }],
        dependency: 1,
      }),
    );
    tops.set('x', 0).set('g', 40).set('m1', 80).set('m2', 160);
    view.rerender(
      harness({
        items: [{ key: 'x' }, { key: 'g', members: ['m1', 'm2'] }],
        dependency: 2,
      }),
    );
    expect(element('g').style.transform).toBe('translate(0px, -40px)');
    expect(element('x').style.transform).toBe('translate(0px, 120px)');
    expect(element('m1').style.transform).toBe('');
    expect(element('m2').style.transform).toBe('translate(0px, -40px)');
  });

  it('honours reduced motion and works without matchMedia', () => {
    tops.set('a', 0).set('b', 40);
    const view = render(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 1 }));
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    tops.set('a', 40).set('b', 0);
    view.rerender(harness({ items: [{ key: 'b' }, { key: 'a' }], dependency: 2 }));
    expect(element('a').style.transform).toBe('');

    (window as { matchMedia?: unknown }).matchMedia = undefined;
    tops.set('a', 0).set('b', 40);
    view.rerender(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 3 }));
    expect(element('a').style.transform).toBe('translate(0px, 40px)');
  });

  it('skips one commit after skipNext and re-measures on capture', () => {
    tops.set('a', 0).set('b', 40);
    const view = render(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 1 }));
    handle?.skipNext();
    tops.set('a', 40).set('b', 0);
    view.rerender(harness({ items: [{ key: 'b' }, { key: 'a' }], dependency: 2 }));
    expect(element('a').style.transform).toBe('');

    // Rows already sit where they will land (e.g. a drag preview): capture makes that the baseline.
    tops.set('a', 0).set('b', 40);
    handle?.capture();
    view.rerender(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 3 }));
    expect(element('a').style.transform).toBe('');
    expect(element('b').style.transform).toBe('');
  });

  it('restarts an animation that is still running and clears styles on unmount', () => {
    tops.set('a', 0).set('b', 40);
    const view = render(harness({ items: [{ key: 'a' }, { key: 'b' }], dependency: 1 }));
    tops.set('a', 40).set('b', 0);
    view.rerender(harness({ items: [{ key: 'b' }, { key: 'a' }], dependency: 2 }));
    act(() => flushFrames());
    tops.set('a', 80).set('b', 0).set('c', 40);
    view.rerender(harness({ items: [{ key: 'b' }, { key: 'c' }, { key: 'a' }], dependency: 3 }));
    expect(element('a').style.transform).toBe('translate(0px, -40px)');
    const a = element('a');
    view.unmount();
    expect(a.style.transform).toBe('');
    expect(a.style.transition).toBe('');
  });
});
