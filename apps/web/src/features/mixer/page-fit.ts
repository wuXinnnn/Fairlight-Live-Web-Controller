/**
 * Spends the width a page could not fill. `paginate` splits the deck at the narrowest geometry
 * there is, so a full page nearly always has some space over — up to a whole strip's worth, when
 * the next strip missed by a hair. Left alone that space piles up at one end of the page; spent
 * here it opens the gaps, stretches the strips a little, and centres what is left.
 *
 * Nothing computed here can change where the pages were split: every figure only grows, and only
 * into space `paginate` had already given up on.
 */

import type { StripPage } from './pagination.js';

export interface PageFitMetrics {
  /** Content-box width of a page — the same figure `paginate` was given. */
  containerWidth: number;
  /** The width pages were split at, and the most a strip may be stretched to. */
  stripWidth: number;
  stripWidthMax: number;
  headerWidth: number;
  /** Space behind a section header. Fixed, so it takes no part in the spending. */
  headerGap: number;
  stripGap: number;
  stripGapMax: number;
  segmentGap: number;
  segmentGapMax: number;
}

export interface PageFit {
  stripGap: number;
  segmentGap: number;
  /** Space before the first strip. Half the remainder on a full page, inherited on a short one. */
  lead: number;
}

export interface DeckFit {
  /** Shared by every page, so turning one never resizes a strip under the operator's hand. */
  stripWidth: number;
  /** One entry per page, in order. */
  pages: PageFit[];
}

interface PageCounts {
  strips: number;
  headers: number;
  segmentGaps: number;
  stripGaps: number;
}

function countPage<T>(page: StripPage<T>): PageCounts {
  let strips = 0;
  let headers = 0;
  for (const segment of page.segments) {
    strips += segment.entries.length;
    if (segment.header) {
      headers += 1;
    }
  }
  return {
    strips,
    headers,
    segmentGaps: Math.max(0, page.segments.length - 1),
    // Only the gaps between two strips of one segment. The one behind a header is not among them.
    stripGaps: Math.max(0, strips - page.segments.length),
  };
}

function naturalWidth(counts: PageCounts, metrics: PageFitMetrics, stripWidth: number): number {
  return (
    counts.headers * (metrics.headerWidth + metrics.headerGap) +
    counts.stripGaps * metrics.stripGap +
    counts.segmentGaps * metrics.segmentGap +
    counts.strips * stripWidth
  );
}

/** How much width the page's gaps could take before they hit their maximum. */
function gapCapacity(counts: PageCounts, metrics: PageFitMetrics): number {
  return (
    counts.stripGaps * (metrics.stripGapMax - metrics.stripGap) +
    counts.segmentGaps * (metrics.segmentGapMax - metrics.segmentGap)
  );
}

/** Whether a page with these counts can be laid out on the page before it without overflowing. */
function inheritable(
  previous: PageFit,
  counts: PageCounts,
  metrics: PageFitMetrics,
  slack: number,
): boolean {
  const cost =
    previous.lead +
    counts.stripGaps * (previous.stripGap - metrics.stripGap) +
    counts.segmentGaps * (previous.segmentGap - metrics.segmentGap);
  return cost <= slack;
}

export function fitPages<T>(pages: readonly StripPage<T>[], metrics: PageFitMetrics): DeckFit {
  const counts = pages.map(countPage);

  // The gaps have first claim on a page's spare width; only what they cannot take goes into the
  // strips. The page with the least to give decides for the whole deck, so no page overflows.
  let growth = Math.max(0, metrics.stripWidthMax - metrics.stripWidth);
  for (const count of counts) {
    if (count.strips === 0) {
      continue;
    }
    const spare =
      metrics.containerWidth -
      naturalWidth(count, metrics, metrics.stripWidth) -
      gapCapacity(count, metrics);
    growth = Math.min(growth, Math.max(0, spare) / count.strips);
  }
  const stripWidth = metrics.stripWidth + growth;

  const fits: PageFit[] = [];
  counts.forEach((count, index) => {
    const slack = Math.max(0, metrics.containerWidth - naturalWidth(count, metrics, stripWidth));
    const capacity = gapCapacity(count, metrics);
    const taken = capacity === 0 ? 0 : Math.min(1, slack / capacity);
    const own: PageFit = {
      stripGap: metrics.stripGap + taken * (metrics.stripGapMax - metrics.stripGap),
      segmentGap: metrics.segmentGap + taken * (metrics.segmentGapMax - metrics.segmentGap),
      lead: (slack - taken * capacity) / 2,
    };
    // Room for another strip means this page ran out of strips, not of width: the last page, or a
    // short one under TYPE PAGES. Centring it on its own would shift every strip on it as the
    // count changes, so it is left-aligned on the page before instead and the strips stay put.
    const previous = fits[index - 1];
    const short = slack >= metrics.stripGap + stripWidth;
    fits.push(
      short && previous !== undefined && inheritable(previous, count, metrics, slack)
        ? { ...previous }
        : own,
    );
  });

  return { stripWidth, pages: fits };
}
