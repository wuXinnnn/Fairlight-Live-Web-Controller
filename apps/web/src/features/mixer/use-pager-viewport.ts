import { useCallback, useEffect, useState } from 'react';

export interface PagerViewport {
  /** Content-box width of the viewport in CSS pixels, or 0 before it is on screen. */
  width: number;
  /** Attach to the pager viewport element. */
  attach: (node: HTMLDivElement | null) => void;
  node: HTMLDivElement | null;
}

/**
 * Measures the pager viewport, which is what decides how many strips fit on a page. The width is
 * read the moment the element is attached, so the first paint already pages correctly, and a
 * `ResizeObserver` keeps it current afterwards; where `ResizeObserver` is missing (jsdom) the
 * attachment measurement stands.
 *
 * The element is tracked through a callback ref rather than a plain one because the mixer swaps
 * the whole deck out for an empty state: an effect keyed on a ref object would measure once
 * against nothing and never look again once the strips arrived.
 */
export function usePagerViewport(): PagerViewport {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const attach = useCallback((element: HTMLDivElement | null) => {
    setNode(element);
    setWidth(element === null ? 0 : element.clientWidth);
  }, []);

  useEffect(() => {
    if (node === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [node]);

  return { width, attach, node };
}
