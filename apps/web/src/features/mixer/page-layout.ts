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
/**
 * Height of the band that labels a type section or a group, and the space between it and the run
 * of strips underneath. The band spans its own strips and nothing else, so a section costs the
 * page height rather than width — which is the axis a page has to spare, since a strip is as tall
 * as the viewport either way. Every section reserves the band whether or not it has one, so the
 * strips of two sections side by side start at the same height.
 */
export const SECTION_HEADER_HEIGHT_PX = 26;
export const SECTION_HEADER_GAP_PX = 6;
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
/**
 * Below this height a strip stops shrinking and the page scrolls instead. It decides the shortest
 * window the mixer fits in without scrolling, pixel for pixel: this figure plus the label band,
 * the page's own vertical padding and the shell's header and footer. Lower it to cover a shorter
 * window; every pixel off here is a pixel off the window the mixer needs.
 */
export const STRIP_MIN_HEIGHT_PX = 511;
/** Width of the page rail down the right-hand side of the deck. */
export const PAGE_RAIL_WIDTH_PX = 72;
/** Duration of the slide between two pages. */
export const PAGE_TRANSITION_MS = 220;
