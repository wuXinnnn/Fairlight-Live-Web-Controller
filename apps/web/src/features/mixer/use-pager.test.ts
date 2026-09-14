import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clampPageIndex, nextPageIndex, usePager } from './use-pager.js';

describe('page index arithmetic', () => {
  it('keeps an index inside the pages that exist', () => {
    expect(clampPageIndex(-3, 5)).toBe(0);
    expect(clampPageIndex(2, 5)).toBe(2);
    expect(clampPageIndex(9, 5)).toBe(4);
    expect(clampPageIndex(3, 0)).toBe(0);
  });

  it('stops stepping at the first and last page', () => {
    expect(nextPageIndex(0, 3, 1)).toBe(1);
    expect(nextPageIndex(2, 3, 1)).toBe(2);
    expect(nextPageIndex(0, 3, -1)).toBe(0);
  });
});

describe('usePager', () => {
  it('steps between pages and stops at both ends', () => {
    const { result } = renderHook(() => usePager(3, null));
    expect(result.current.pageIndex).toBe(0);

    act(() => {
      result.current.previous();
    });
    expect(result.current.pageIndex).toBe(0);

    act(() => {
      result.current.next();
      result.current.next();
      result.current.next();
    });
    expect(result.current.pageIndex).toBe(2);

    act(() => {
      result.current.goTo(99);
    });
    expect(result.current.pageIndex).toBe(2);
    act(() => {
      result.current.goTo(1);
    });
    expect(result.current.pageIndex).toBe(1);
  });

  it('returns to the first page when the view changes', () => {
    const { result, rerender } = renderHook(({ key }) => usePager(4, key), {
      initialProps: { key: 'foh' as string | null },
    });
    act(() => {
      result.current.goTo(3);
    });
    expect(result.current.pageIndex).toBe(3);

    rerender({ key: 'monitors' });
    expect(result.current.pageIndex).toBe(0);
  });

  it('pins to the last page when pages are lost and stays there when they come back', () => {
    const { result, rerender } = renderHook(({ count }) => usePager(count, null), {
      initialProps: { count: 5 },
    });
    act(() => {
      result.current.goTo(4);
    });
    expect(result.current.pageIndex).toBe(4);

    rerender({ count: 2 });
    expect(result.current.pageIndex).toBe(1);

    // Widening the viewport again must not spring the pager back to where it used to be.
    rerender({ count: 5 });
    expect(result.current.pageIndex).toBe(1);
  });
});
