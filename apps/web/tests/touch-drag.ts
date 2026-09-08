import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Drives dnd-kit's touch sensor. The sensor attaches its move and end listeners to the element
 * the touch started on (a drag handle), so every event here is dispatched on that handle.
 * jsdom has no `Touch` constructor, but its `TouchEvent` accepts plain touch-shaped objects and
 * `getEventCoordinates` reads `clientX` / `clientY` off them.
 */
function touchList(target: HTMLElement, x: number, y: number) {
  return [{ identifier: 0, target, clientX: x, clientY: y, pageX: x, pageY: y }];
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function touchStart(handle: HTMLElement, x: number, y: number): Promise<void> {
  const touches = touchList(handle, x, y);
  fireEvent.touchStart(handle, { touches, targetTouches: touches, changedTouches: touches });
  await flush();
}

export async function touchMove(handle: HTMLElement, x: number, y: number): Promise<void> {
  const touches = touchList(handle, x, y);
  fireEvent.touchMove(handle, { touches, targetTouches: touches, changedTouches: touches });
  await flush();
}

export async function touchEnd(handle: HTMLElement, x: number, y: number): Promise<void> {
  const touches = touchList(handle, x, y);
  fireEvent.touchEnd(handle, { touches: [], targetTouches: [], changedTouches: touches });
  await flush();
}

/** Lets the touch sensor's press delay elapse while React flushes the resulting drag start. */
export async function advanceTouchDelay(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}
