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
 * The travel that counts towards a page turn. Only the vertical axis does, except under Shift:
 * the browser reports a vertical wheel on `deltaX` while it is held, and that is the escape hatch
 * for turning a page from a fader track. A trackpad reports the sideways wander of a two-finger
 * swipe on `deltaX` too, in frames where the finger has not yet moved far enough down to round to
 * a whole pixel — reading that axis unasked turns a swipe into a page turn the other way.
 */
export function pagingDelta(axis: { x: number; y: number }, shiftKey: boolean): number {
  return shiftKey && axis.y === 0 ? axis.x : axis.y;
}
