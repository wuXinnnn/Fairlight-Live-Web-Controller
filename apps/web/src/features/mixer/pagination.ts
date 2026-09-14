/**
 * Splits the mixer's segments into pages that each fit the pager viewport. The mixer never wraps
 * or scrolls horizontally: a strip is either on the page you are looking at or on another one, so
 * the split has to be decided up front from measured widths rather than left to the browser.
 */

export interface PageMetrics {
  /** Content-box width of the pager viewport. */
  containerWidth: number;
  stripWidth: number;
  stripGap: number;
  segmentGap: number;
}

export interface LayoutSegment<T> {
  key: string;
  /** True for a type section or a group, which is rendered with a label band over its strips. */
  header: boolean;
  entries: T[];
}

export interface PageSegment<T> extends LayoutSegment<T> {
  /** The segment already placed entries on an earlier page, so a header here is a repeat. */
  continued: boolean;
}

export interface StripPage<T> {
  segments: PageSegment<T>[];
}

/**
 * Greedily fills pages one strip at a time. A strip costs the gap that precedes it (a segment gap
 * when it opens a new segment, a strip gap when it continues one) plus the strip itself; a strip
 * whose cost overflows the remaining width opens the next page. A section's label costs no width
 * at all — the band sits over the strips rather than beside them. A headered segment that spans
 * pages repeats its band, marked `continued`.
 *
 * Empty segments produce nothing, and no input at all returns no pages — callers size the pager
 * with `Math.max(1, pages.length)`. A container narrower than a single strip still gets exactly
 * one strip per page rather than looping forever.
 */
export function paginate<T>(
  segments: readonly LayoutSegment<T>[],
  metrics: PageMetrics,
  options: { newPagePerHeaderedSegment: boolean },
): StripPage<T>[] {
  const pages: StripPage<T>[] = [];
  let current: PageSegment<T>[] = [];
  let used = 0;

  const endPage = () => {
    if (current.length > 0) {
      pages.push({ segments: current });
      current = [];
      used = 0;
    }
  };

  for (const segment of segments) {
    if (segment.entries.length === 0) {
      continue;
    }
    if (options.newPagePerHeaderedSegment && segment.header) {
      endPage();
    }
    // Whether this segment has already opened on the page being filled, and whether it placed
    // entries on an earlier one — the two differ on the page a segment spills onto.
    let open = false;
    let continued = false;

    for (const entry of segment.entries) {
      let cost = stripCost(metrics, open, used > 0);
      if (used > 0 && used + cost > metrics.containerWidth) {
        endPage();
        continued = true;
        open = false;
        cost = stripCost(metrics, false, false);
      }
      if (!open) {
        current.push({ key: segment.key, header: segment.header, entries: [], continued });
        open = true;
      }
      current[current.length - 1]?.entries.push(entry);
      used += cost;
    }
  }
  endPage();
  return pages;
}

function stripCost(metrics: PageMetrics, segmentOpen: boolean, pageUsed: boolean): number {
  const gap = pageUsed ? (segmentOpen ? metrics.stripGap : metrics.segmentGap) : 0;
  return gap + metrics.stripWidth;
}
