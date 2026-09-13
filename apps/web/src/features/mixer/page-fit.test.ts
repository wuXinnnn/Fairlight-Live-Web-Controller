import { describe, expect, it } from 'vitest';
import { fitPages, type PageFitMetrics } from './page-fit.js';
import type { StripPage } from './pagination.js';

const METRICS: PageFitMetrics = {
  containerWidth: 0,
  stripWidth: 100,
  stripWidthMax: 120,
  headerWidth: 50,
  headerGap: 1,
  stripGap: 1,
  stripGapMax: 6,
  segmentGap: 10,
  segmentGapMax: 20,
};

/** A page of one headerless segment holding `strips` strips. */
function loose(strips: number): StripPage<number> {
  return {
    segments: [
      {
        key: 'loose',
        header: false,
        continued: false,
        entries: Array.from({ length: strips }, (_, index) => index),
      },
    ],
  };
}

/** A page of one headered segment holding `strips` strips. */
function headed(strips: number, key = 'headed'): StripPage<number> {
  return {
    segments: [
      {
        key,
        header: true,
        continued: false,
        entries: Array.from({ length: strips }, (_, index) => index),
      },
    ],
  };
}

function metrics(containerWidth: number): PageFitMetrics {
  return { ...METRICS, containerWidth };
}

describe('fitPages', () => {
  it('leaves a page that fills its width exactly alone', () => {
    // Four strips and the three gaps between them, to the pixel.
    const fit = fitPages([loose(4)], metrics(4 * 100 + 3 * 1));

    expect(fit.stripWidth).toBe(100);
    expect(fit.pages[0]).toEqual({ stripGap: 1, segmentGap: 10, lead: 0 });
  });

  it('opens the gaps before it touches the strips', () => {
    // Ten pixels over: the three gaps could take fifteen, so they take ten of it and no more.
    const fit = fitPages([loose(4)], metrics(4 * 100 + 3 * 1 + 10));

    expect(fit.stripWidth).toBe(100);
    const page = fit.pages[0];
    expect(page?.stripGap).toBeCloseTo(1 + (10 / 15) * 5);
    expect(page?.lead).toBe(0);
    // Everything the page was given is on the page.
    expect(4 * 100 + 3 * (page?.stripGap ?? 0)).toBeCloseTo(4 * 100 + 3 * 1 + 10);
  });

  it('stretches the strips once the gaps are wide open', () => {
    // Ninety over. Fifteen goes to the gaps, the other seventy-five is shared by four strips.
    const fit = fitPages([loose(4)], metrics(4 * 100 + 3 * 1 + 90));

    expect(fit.stripWidth).toBeCloseTo(100 + 75 / 4);
    expect(fit.pages[0]?.stripGap).toBe(6);
    expect(fit.pages[0]?.lead).toBe(0);
  });

  it('stops stretching at the maximum and centres what is over', () => {
    const fit = fitPages([loose(4)], metrics(4 * 100 + 3 * 1 + 200));

    expect(fit.stripWidth).toBe(120);
    // 200 spare, less 15 to the gaps and 80 to the strips, halved either side.
    expect(fit.pages[0]?.lead).toBeCloseTo((200 - 15 - 80) / 2);
  });

  it('gives every page the width the tightest one can afford', () => {
    // The headered page carries 51px of chrome the loose one does not, so it has that much less
    // to spend, and its allowance is the one the whole deck gets.
    const width = 4 * 100 + 3 * 1 + 51 + 90;
    const fit = fitPages([loose(4), headed(4)], metrics(width));

    expect(fit.stripWidth).toBeCloseTo(100 + 75 / 4);
    // The loose page has the header's width over, and centres it.
    expect(fit.pages[0]?.lead).toBeCloseTo(51 / 2);
    expect(fit.pages[1]?.lead).toBe(0);
  });

  it('never lets the space behind a header pay for the other gaps', () => {
    // Two headered segments: four strips, two headers, two strip gaps, one segment gap. The two
    // header gaps are not among the gaps that may open, so they stay at a pixel each.
    const page: StripPage<number> = {
      segments: [
        { key: 'a', header: true, continued: false, entries: [0, 1] },
        { key: 'b', header: true, continued: false, entries: [2, 3] },
      ],
    };
    const natural = 2 * (50 + 1) + 2 * 1 + 10 + 4 * 100;
    const fit = fitPages([page], metrics(natural + 1000));

    // Capacity is the two strip gaps and the one segment gap; the header gaps add nothing to it.
    const capacity = 2 * (6 - 1) + 1 * (20 - 10);
    expect(fit.stripWidth).toBe(120);
    expect(fit.pages[0]?.lead).toBeCloseTo((1000 - capacity - 4 * 20) / 2);
  });

  it('lays a short last page out under the page before it', () => {
    const width = 4 * 100 + 3 * 1 + 90;
    const fit = fitPages([loose(4), loose(1)], metrics(width));

    // The short page has room for three more strips, so it takes the full page's geometry rather
    // than centring its single strip in the middle of the desk.
    expect(fit.pages[1]).toEqual(fit.pages[0]);
    expect(fit.pages[1]?.lead).toBe(0);
  });

  it('passes an inherited layout down a run of short pages', () => {
    const width = 4 * 100 + 3 * 1 + 200;
    const fit = fitPages([loose(4), loose(1), loose(2)], metrics(width));

    expect(fit.pages[1]).toEqual(fit.pages[0]);
    expect(fit.pages[2]).toEqual(fit.pages[0]);
    expect(fit.pages[0]?.lead).toBeGreaterThan(0);
  });

  it('centres the first page even when it is the only one and half empty', () => {
    const fit = fitPages([loose(1)], metrics(1000));

    expect(fit.stripWidth).toBe(120);
    expect(fit.pages[0]?.lead).toBeCloseTo((1000 - 120) / 2);
  });

  it('falls back to natural geometry when the page does not even fit', () => {
    // The degenerate case `paginate` allows: a container narrower than a single strip still gets
    // one strip on the page. Nothing may be stretched, and the lead may not go negative.
    const fit = fitPages([loose(1)], metrics(40));

    expect(fit.stripWidth).toBe(100);
    expect(fit.pages[0]).toEqual({ stripGap: 1, segmentGap: 10, lead: 0 });
  });

  it('has nothing to fit when the deck is empty', () => {
    expect(fitPages([], metrics(1000)).pages).toEqual([]);
  });
});
