import { act, fireEvent, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Drives dnd-kit's keyboard sensor. Space on a drag handle picks its item up; dnd-kit then
 * attaches its document keydown listener from a timeout, so the helper yields one macrotask
 * before the caller sends arrow keys.
 */
export async function pickUp(handle: HTMLElement): Promise<void> {
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
  await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export type DragKey = 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Space' | 'Escape';

/** Sends one keyboard drag command to the document and lets React flush. */
export async function press(code: DragKey): Promise<void> {
  fireEvent.keyDown(document, { code, key: code === 'Space' ? ' ' : code });
  await act(async () => {
    await Promise.resolve();
  });
}
