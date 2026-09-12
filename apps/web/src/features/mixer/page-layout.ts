/**
 * Geometry of the paginated mixer, in CSS pixels. The pagination function needs these numbers to
 * decide how many strips fit on a page, and the stylesheet needs them to lay the page out; they
 * live here so the two can never drift apart. `MixerPage` publishes every one of them as a custom
 * property on `.mixer-shell`, and `styles.css` reads them back with `var(...)` rather than
 * repeating the figures.
 */

/** Width of a channel strip. */
export const STRIP_WIDTH_PX = 148;
/** Width of the vertical header that labels a type section or a group. */
export const SECTION_HEADER_WIDTH_PX = 52;
/** Space between two strips of the same segment. */
export const STRIP_GAP_PX = 1;
/** Space between two adjacent segments. */
export const SEGMENT_GAP_PX = 14;
/** Below this height a page stops shrinking and the pager viewport scrolls instead. */
export const STRIP_MIN_HEIGHT_PX = 528;
/** Width of the page rail down the right-hand side of the deck. */
export const PAGE_RAIL_WIDTH_PX = 56;
/** Duration of the slide between two pages. */
export const PAGE_TRANSITION_MS = 220;
