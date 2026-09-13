/**
 * Geometry of the paginated mixer, in CSS pixels. The pagination function needs these numbers to
 * decide how many strips fit on a page, and the stylesheet needs them to lay the page out; they
 * live here so the two can never drift apart. `MixerPage` publishes every one of them as a custom
 * property on `.mixer-shell`, and `styles.css` reads them back with `var(...)` rather than
 * repeating the figures.
 */

/**
 * Width of a channel strip, and the most it may be stretched to. A strip is the same width at
 * every viewport: the ceiling is set to the floor, so the width a page cannot fill goes into its
 * gaps and its centring rather than into the strips. Raising the ceiling reopens the stretch;
 * pages are split at the floor, so only the floor changes how many strips fit on one.
 */
export const STRIP_WIDTH_PX = 125;
export const STRIP_WIDTH_MAX_PX = 125;
/** Width of the vertical header that labels a type section or a group. */
export const SECTION_HEADER_WIDTH_PX = 52;
/**
 * Space between a section header and the first strip behind it. It is fixed: the header reads as
 * the shoulder of the run it labels, so it must not drift away from it as the other gaps open up.
 */
export const SECTION_HEADER_GAP_PX = 1;
/** Space between two strips of the same segment, and the most it may open to. */
export const STRIP_GAP_PX = 1;
export const STRIP_GAP_MAX_PX = 6;
/** Space between two adjacent segments, and the most it may open to. */
export const SEGMENT_GAP_PX = 14;
export const SEGMENT_GAP_MAX_PX = 28;
/**
 * Space a page keeps on each side of its strips. It comes out of the page's width, so the
 * pagination function has to be given the width without it.
 */
export const PAGE_PADDING_X_PX = 24;
/** Below this height a page stops shrinking and the pager viewport scrolls instead. */
export const STRIP_MIN_HEIGHT_PX = 528;
/** Width of the page rail down the right-hand side of the deck. */
export const PAGE_RAIL_WIDTH_PX = 72;
/** Duration of the slide between two pages. */
export const PAGE_TRANSITION_MS = 220;
