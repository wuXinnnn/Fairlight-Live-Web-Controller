/**
 * Initial sensor values for the configuration page drag and drop. They are starting points to
 * be tuned against the real console; the touch values in particular belong to the touch audit.
 */
import type { MeasuringConfiguration } from '@dnd-kit/core';
import { naturalRect } from './flip-geometry.js';

/** Mouse movement, in CSS pixels, before a press on a drag handle becomes a drag. */
export const MOUSE_ACTIVATION_DISTANCE_PX = 4;

/**
 * Press duration, in milliseconds, a finger must rest on a drag handle before the touch becomes
 * a drag. Below it the gesture stays with the page, so a flick still scrolls the list.
 */
export const TOUCH_ACTIVATION_DELAY_MS = 100;

/**
 * Finger movement, in CSS pixels, tolerated while the touch delay runs. Moving further reads as
 * a scroll and cancels the press, so the drag never starts.
 */
export const TOUCH_ACTIVATION_TOLERANCE_PX = 8;

/** Duration, in milliseconds, of the drag overlay animation that flies the clone to its row. */
export const DROP_ANIMATION_MS = 150;

/** How far, in CSS pixels, the pointer must leave the CHANNEL ORDER list before a drop removes the item. */
export const REMOVE_DRAG_THRESHOLD_PX = 64;

/** Distance from the top or bottom edge of the list, in CSS pixels, where dragging starts to scroll it. */
export const AUTO_SCROLL_EDGE_PX = 48;

/** Fastest auto-scroll step, in CSS pixels per animation frame, reached right at the edge. */
export const AUTO_SCROLL_MAX_STEP_PX = 12;

/** Minimum interval, in milliseconds, between droppable re-measurements while auto-scrolling. */
export const AUTO_SCROLL_REMEASURE_MS = 50;

/** Height, in CSS pixels, of the drop slots shown before, between and after groups while a channel is dragged. */
export const ROOT_SLOT_HEIGHT_PX = 16;

/**
 * Measure droppables at their natural position, so collision detection aims at the layout the
 * preview is settling into rather than at wherever a FLIP tween happens to have a row right now.
 * dnd-kit's own transform-agnostic measurement only unwinds the node's own transform, which is
 * not enough here: a member row is carried by its group block, and that block is animated too.
 * It is a module constant because dnd-kit memoises the measuring configuration by identity.
 */
export const VIEW_MEASURING: MeasuringConfiguration = { droppable: { measure: naturalRect } };
