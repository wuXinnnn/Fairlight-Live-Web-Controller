import { useCallback, useState } from 'react';

/** Keeps a page index inside the pages that exist; an empty pager still sits on page 0. */
export function clampPageIndex(index: number, pageCount: number): number {
  return Math.min(Math.max(index, 0), Math.max(pageCount - 1, 0));
}

/** The page one step away in `direction`, stopping at the first and last page. */
export function nextPageIndex(index: number, pageCount: number, direction: -1 | 1): number {
  return clampPageIndex(index + direction, pageCount);
}

export interface Pager {
  pageIndex: number;
  next(): void;
  previous(): void;
  goTo(index: number): void;
}

/**
 * The page the mixer is showing. Losing pages pins the pager to the last one that is left and
 * keeps it there when pages come back, so a window resize settles rather than springing back to
 * where it was; `resetKey` (the active view) is the only thing that returns it to the first page.
 */
export function usePager(pageCount: number, resetKey: string | null): Pager {
  const [index, setIndex] = useState(0);
  const [seenKey, setSeenKey] = useState(resetKey);
  const [seenCount, setSeenCount] = useState(pageCount);

  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setIndex(0);
  }
  // Losing pages moves the pager rather than only hiding where it was, so widening the viewport
  // again leaves it on the page the operator is looking at.
  if (seenCount !== pageCount) {
    setSeenCount(pageCount);
    setIndex((current) => clampPageIndex(current, pageCount));
  }

  const goTo = useCallback(
    (target: number) => {
      setIndex(clampPageIndex(target, pageCount));
    },
    [pageCount],
  );
  const next = useCallback(() => {
    setIndex((current) => nextPageIndex(current, pageCount, 1));
  }, [pageCount]);
  const previous = useCallback(() => {
    setIndex((current) => nextPageIndex(current, pageCount, -1));
  }, [pageCount]);

  return { pageIndex: clampPageIndex(index, pageCount), next, previous, goTo };
}
