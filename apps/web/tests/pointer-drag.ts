import { act, fireEvent } from '@testing-library/react';

/**
 * Drives dnd-kit's pointer sensor with synthetic pointer events. The sensor listens for moves on
 * the document once a handle is pressed, and the page tracks the pointer on the window, so both
 * see the events dispatched here. Coordinates are viewport pixels of the layout stub.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function pointerDown(handle: HTMLElement, x: number, y: number): Promise<void> {
  fireEvent.pointerDown(handle, {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  await flush();
}

export async function pointerMoveTo(x: number, y: number): Promise<void> {
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: x, clientY: y });
  await flush();
}

/** dnd-kit keeps swallowing clicks on the document for this long after a pointer drag ends. */
const CLICK_SUPPRESSION_MS = 50;

export async function pointerUp(x: number, y: number): Promise<void> {
  fireEvent.pointerUp(document, {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  await flush();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, CLICK_SUPPRESSION_MS + 10));
  });
}
