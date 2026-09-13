import { useCallback, useState } from 'react';

interface PageRailProps {
  pageIndex: number;
  pageCount: number;
  onPrevious(): void;
  onNext(): void;
  onGoTo(index: number): void;
}

/**
 * The safe strip down the right-hand side of the deck: the one place an operator can put a thumb
 * or a cursor without touching the sound. It carries the page counter, the two page keys and the
 * surface a finger turns pages on, and nothing else — no control here may reach a channel. It
 * stays put whatever the page count is, so muscle memory holds between views.
 */
export function PageRail({ pageIndex, pageCount, onPrevious, onNext, onGoTo }: PageRailProps) {
  /** The page being typed into the counter, or null while it is only a readout. */
  const [draft, setDraft] = useState<string | null>(null);

  // A stable callback ref, not an inline one: an inline ref runs on every render and would take
  // the selection back from under the operator between one keystroke and the next.
  const openField = useCallback((field: HTMLInputElement | null) => {
    if (field !== null) {
      field.focus();
      field.select();
    }
  }, []);

  const commit = () => {
    if (draft === null) {
      // Confirming closes the field, and the blur that follows it must not jump a second time.
      return;
    }
    const wanted = Number.parseInt(draft, 10);
    if (Number.isFinite(wanted)) {
      onGoTo(wanted - 1);
    }
    setDraft(null);
  };

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
        {draft === null ? (
          <button
            type="button"
            className="page-rail__jump"
            aria-label="Jump to page"
            title="Jump to page"
            disabled={pageCount <= 1}
            onClick={() => {
              setDraft(String(pageIndex + 1));
            }}
          >
            {pageIndex + 1} / {pageCount}
          </button>
        ) : (
          <input
            ref={openField}
            className="page-rail__jump"
            aria-label="Jump to page"
            inputMode="numeric"
            maxLength={3}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.replace(/\D/gu, ''));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit();
              } else if (event.key === 'Escape') {
                setDraft(null);
              }
            }}
            onBlur={commit}
          />
        )}
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
      {/* The swipe surface: the deck turns pages from a finger dragged anywhere on the rail, and
          this is the part of it that is always empty to grab. */}
      <div className="page-rail__track" data-swipe-surface />
    </aside>
  );
}
