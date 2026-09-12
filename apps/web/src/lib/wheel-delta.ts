/**
 * Wheel events do not agree on a unit: a mouse notch usually arrives in pixels, Firefox reports
 * lines, and a few environments report pages. Everything downstream works in pixels, so the
 * conversion happens once, here.
 */

/** Assumed line height when a wheel event reports `deltaMode` 1. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Assumed page height when a wheel event reports `deltaMode` 2. */
export const WHEEL_PAGE_HEIGHT_PX = 800;

type WheelDelta = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>;

export function normalizeWheelDelta(event: WheelDelta): { x: number; y: number } {
  const scale =
    event.deltaMode === 1 ? WHEEL_LINE_HEIGHT_PX : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT_PX : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * The delta that should turn a page. Holding Shift makes the browser report a vertical wheel on
 * `deltaX` instead, so whichever axis is moving is the one that counts; if both are, the vertical
 * one wins.
 */
export function pagingDelta(event: WheelDelta): number {
  const { x, y } = normalizeWheelDelta(event);
  return y !== 0 ? y : x;
}
