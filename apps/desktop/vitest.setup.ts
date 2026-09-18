import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements neither of these, and the log pane calls both when a new line arrives.
Element.prototype.scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), writable: true });

afterEach(cleanup);
