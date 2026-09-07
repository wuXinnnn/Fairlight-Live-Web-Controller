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

/** How far, in CSS pixels, the pointer must leave the CHANNEL ORDER list before a drop removes the item. */
export const REMOVE_DRAG_THRESHOLD_PX = 64;

/** Distance from the top or bottom edge of the list, in CSS pixels, where dragging starts to scroll it. */
export const AUTO_SCROLL_EDGE_PX = 48;

/** Fastest auto-scroll step, in CSS pixels per animation frame, reached right at the edge. */
export const AUTO_SCROLL_MAX_STEP_PX = 12;

/** Minimum interval, in milliseconds, between droppable re-measurements while auto-scrolling. */
export const AUTO_SCROLL_REMEASURE_MS = 50;
