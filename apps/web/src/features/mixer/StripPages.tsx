import { type CSSProperties, type ReactNode } from 'react';
import type { StripPage } from './pagination.js';

/** How many pages either side of the current one stay mounted, so their meters stay subscribed. */
const MOUNTED_PAGE_RADIUS = 1;

/** One channel strip, rendered on demand so off-screen pages cost nothing. */
export interface StripStub {
  key: string;
  /** `position` is the strip's index within its page, which drives the entry animation. */
  render(position: number): ReactNode;
}

/** Everything a headered segment needs around its strips: the vertical label and its counter. */
export interface SegmentChrome {
  headingId: string;
  label: string;
  /** Channels of the segment currently present, shown zero-padded beside the label. */
  count: number;
  accent: string;
  channelKind?: string;
  viewGroupId?: string;
}

interface StripPagesProps {
  pages: StripPage<StripStub>[];
  chrome: Map<string, SegmentChrome>;
  pageIndex: number;
}

/**
 * The pager track. Every page is a full-width flex row and the track slides by whole pages, so a
 * page's strips are either fully on screen or fully off it — the mixer never half-shows a strip.
 * Only the current page and its immediate neighbours render their strips; the rest are empty
 * boxes that hold their place in the track, which keeps the number of live meters bounded.
 */
export function StripPages({ pages, chrome, pageIndex }: StripPagesProps) {
  return (
    <div className="mixer-pages" style={{ '--page-index': pageIndex } as CSSProperties}>
      {pages.map((page, index) => {
        if (Math.abs(index - pageIndex) > MOUNTED_PAGE_RADIUS) {
          return <div className="mixer-page" key={index} />;
        }
        let position = 0;
        return (
          <div className="mixer-page" key={index}>
            {page.segments.map((segment) => {
              const strips = segment.entries.map((entry) => {
                const rendered = entry.render(position);
                position += 1;
                return rendered;
              });
              const chromeForSegment = chrome.get(segment.key);
              if (!segment.header || chromeForSegment === undefined) {
                return (
                  <section className="mixer-section" key={segment.key}>
                    {strips}
                  </section>
                );
              }
              // A segment that spilled onto this page repeats its header, so the heading id has
              // to carry the page with it — both pages can be mounted at the same time.
              const headingId = `${chromeForSegment.headingId}-p${index}`;
              return (
                <section
                  className="mixer-section"
                  key={segment.key}
                  aria-labelledby={headingId}
                  data-channel-kind={chromeForSegment.channelKind}
                  data-view-group-id={chromeForSegment.viewGroupId}
                  style={{ '--channel-accent': chromeForSegment.accent } as CSSProperties}
                >
                  <header className="mixer-section__header">
                    <h2 id={headingId}>{chromeForSegment.label}</h2>
                    <span>{chromeForSegment.count.toString().padStart(2, '0')}</span>
                  </header>
                  {strips}
                </section>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
