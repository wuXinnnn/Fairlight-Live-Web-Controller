/**
 * Initial sensor values for the configuration page drag and drop. They are starting points to
 * be tuned against the real console; the touch values in particular belong to the touch audit.
 */

/** Pointer movement, in CSS pixels, before a press on a drag handle becomes a drag. */
export const POINTER_ACTIVATION_DISTANCE_PX = 4;

/** Press duration, in milliseconds, before a touch on a drag handle becomes a drag. */
export const TOUCH_ACTIVATION_DELAY_MS = 250;

/** Finger movement, in CSS pixels, tolerated during the touch delay before the press is cancelled. */
export const TOUCH_ACTIVATION_TOLERANCE_PX = 8;
