import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

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

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.mocked(window.scrollTo).mockClear();
});

afterEach(cleanup);
