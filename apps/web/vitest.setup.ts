import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom does not implement window.scrollTo; the app resets scroll on every route change.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
// Nor Element.scrollIntoView, which dnd-kit calls when a keyboard drag starts.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.mocked(window.scrollTo).mockClear();
});

afterEach(cleanup);
