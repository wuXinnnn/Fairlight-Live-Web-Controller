import { useCallback, useState } from 'react';
import type { FullscreenState } from '../../lib/use-fullscreen.js';

interface PageRailProps {
  pageIndex: number;
  pageCount: number;
  onPrevious(): void;
  onNext(): void;
  onGoTo(index: number): void;
  fullscreen: FullscreenState;
}

/**
 * The safe strip down the right-hand side of the deck: the one place an operator can put a thumb
 * or a cursor without touching the sound. It carries the page counter, the two page keys, the
 * surface a finger turns pages on, and the full screen key at the foot of it — no control here
 * may reach a channel, and full screen reaches nothing but the browser's own chrome. It stays
 * put whatever the page count is, so muscle memory holds between views.
 */
export function PageRail({
  pageIndex,
  pageCount,
  onPrevious,
  onNext,
  onGoTo,
  fullscreen,
}: PageRailProps) {
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
          this is the part of it that is always empty to grab. It takes the space the page keys
          and the full screen key leave, which is what puts that key in the bottom corner. */}
      <div className="page-rail__track" data-swipe-surface />
      {/*
       * Not rendered at all where the browser has no element full screen, so on iPhone Safari
       * there is no key here rather than one that does nothing. The state is carried by the
       * label rather than aria-pressed: a pressed state in this rail belongs to a channel
       * control, and nothing in here is one.
       */}
      {fullscreen.supported && (
        <button
          type="button"
          className="page-rail__step"
          aria-label={fullscreen.active ? 'Exit full screen' : 'Enter full screen'}
          title={fullscreen.active ? 'Exit full screen' : 'Enter full screen'}
          onClick={fullscreen.toggle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d={
                fullscreen.active
                  ? 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5'
                  : 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'
              }
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="square"
            />
          </svg>
        </button>
      )}
    </aside>
  );
}
