import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubMixerLayout } from './tests/stub-mixer-layout.js';
import { stubResizeObserver } from './tests/stub-resize-observer.js';
import { wheelGestureTracker } from './src/lib/wheel-gesture.js';

// jsdom does not implement window.scrollTo; the app resets scroll on every route change.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
// Nor Element.scrollIntoView, which dnd-kit calls when a keyboard drag starts.
Element.prototype.scrollIntoView = vi.fn();
// Nor the Web Animations API, which dnd-kit's DragOverlay uses for its drop animation.
Element.prototype.animate = vi.fn(() => {
  const animation = { onfinish: null as (() => void) | null, cancel: vi.fn(), finish: vi.fn() };
  setTimeout(() => animation.onfinish?.(), 0);
  return animation as unknown as Animation;
});

// Nor HTMLMediaElement.play/pause, which the wake lock's video fallback calls on every mixer
// mount. Plain functions rather than vi.fn(): a shared mock would carry one test's queued
// behaviour into the next. A test that needs to watch or reject these spies on them itself.
HTMLMediaElement.prototype.play = function play() {
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause() {
  // Nothing to do: jsdom has no playback to stop.
};

// jsdom implements neither ResizeObserver nor layout, and the mixer pages itself from both.
stubResizeObserver();
stubMixerLayout();

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.mocked(window.scrollTo).mockClear();
});

afterEach(cleanup);
// The wheel tracker is a module singleton, so a gesture left open would leak into the next test.
afterEach(() => {
  wheelGestureTracker.reset();
});
