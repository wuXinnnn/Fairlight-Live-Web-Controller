interface PageRailProps {
  pageIndex: number;
  pageCount: number;
  onPrevious(): void;
  onNext(): void;
}

/**
 * The safe strip down the right-hand side of the deck: the one place an operator can put a thumb
 * or a cursor without touching the sound. It carries the page counter, the two page keys and an
 * inert track, and nothing else — no control here may reach a channel. It stays put whatever the
 * page count is, so muscle memory holds between views.
 */
export function PageRail({ pageIndex, pageCount, onPrevious, onNext }: PageRailProps) {
  return (
    <aside className="page-rail" aria-label="Pages">
      <button
        type="button"
        className="page-rail__step"
        aria-label="Previous page"
        disabled={pageIndex <= 0}
        onClick={onPrevious}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 15 12 8l7 7" fill="none" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      </button>
      <output className="page-rail__count" aria-label="Page">
        {pageIndex + 1} / {pageCount}
      </output>
      <button
        type="button"
        className="page-rail__step"
        aria-label="Next page"
        disabled={pageIndex >= pageCount - 1}
        onClick={onNext}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      </button>
      {/* Reserved for the swipe gesture; empty for now, but it must already swallow touches. */}
      <div className="page-rail__track" data-swipe-surface />
    </aside>
  );
}
