import { type CSSProperties, type ReactNode } from 'react';
import type { PageFit } from './page-fit.js';
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
  /** How each page spends the width it could not fill, in the same order as `pages`. */
  fits: PageFit[];
  chrome: Map<string, SegmentChrome>;
  pageIndex: number;
}

/** The gaps and the leading space of one page, or nothing when it is to use the deck's own. */
function pageStyle(fit: PageFit | undefined): CSSProperties | undefined {
  if (fit === undefined) {
    return undefined;
  }
  return {
    '--strip-gap': `${fit.stripGap}px`,
    '--segment-gap': `${fit.segmentGap}px`,
    '--page-lead': `${fit.lead}px`,
  } as CSSProperties;
}

/**
 * The pager track. Every page is a flex row one viewport tall and the track slides up by whole
 * pages, so a page's strips are either fully on screen or fully off it — the mixer never
 * half-shows a strip. Only the current page and its immediate neighbours render their strips; the
 * rest are empty boxes that hold their place in the track, which keeps the number of live meters
 * bounded. The page in view is marked `data-current`: it is the one that scrolls when the
 * viewport is too short for a strip, and the wheel has to ask it how far it has left to go.
 */
export function StripPages({ pages, fits, chrome, pageIndex }: StripPagesProps) {
  return (
    <div className="mixer-pages" style={{ '--page-index': pageIndex } as CSSProperties}>
      {pages.map((page, index) => {
        const current = index === pageIndex ? '' : undefined;
        const style = pageStyle(fits[index]);
        if (Math.abs(index - pageIndex) > MOUNTED_PAGE_RADIUS) {
          return <div className="mixer-page" key={index} data-current={current} style={style} />;
        }
        let position = 0;
        return (
          <div className="mixer-page" key={index} data-current={current} style={style}>
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
