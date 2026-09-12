import { describe, expect, it } from 'vitest';
import { paginate, type LayoutSegment, type PageMetrics } from './pagination.js';

const METRICS: PageMetrics = {
  containerWidth: 595,
  stripWidth: 148,
  headerWidth: 52,
  stripGap: 1,
  segmentGap: 14,
};

function segment(key: string, header: boolean, count: number): LayoutSegment<string> {
  return { key, header, entries: Array.from({ length: count }, (_, index) => `${key}-${index}`) };
}

function shape(pages: ReturnType<typeof paginate<string>>): string[][] {
  return pages.map((page) => page.segments.flatMap(({ entries }) => entries));
}

describe('paginate', () => {
  it('fits as many strips per page as the container allows', () => {
    // Four loose strips cost 148 + 3 * (1 + 148) = 595.
    const loose = [segment('loose', false, 8)];

    expect(shape(paginate(loose, METRICS, { newPagePerHeaderedSegment: false }))[0]).toHaveLength(
      4,
    );
    expect(
      shape(
        paginate(loose, { ...METRICS, containerWidth: 594 }, { newPagePerHeaderedSegment: false }),
      )[0],
    ).toHaveLength(3);
  });

  it('fits one strip fewer when the segment carries a header', () => {
    const headered = paginate([segment('inputs', true, 8)], METRICS, {
      newPagePerHeaderedSegment: false,
    });

    // The header and its gap cost 53, which is more than the 148 + 1 a fourth strip would need.
    expect(shape(headered)[0]).toHaveLength(3);
  });

  it('repeats the header of a segment that spans pages and marks it continued', () => {
    const pages = paginate([segment('rhythm', true, 5)], METRICS, {
      newPagePerHeaderedSegment: false,
    });

    expect(shape(pages)).toEqual([
      ['rhythm-0', 'rhythm-1', 'rhythm-2'],
      ['rhythm-3', 'rhythm-4'],
    ]);
    expect(pages[0]?.segments[0]).toMatchObject({ key: 'rhythm', header: true, continued: false });
    expect(pages[1]?.segments[0]).toMatchObject({ key: 'rhythm', header: true, continued: true });
  });

  it('starts every headered segment on its own page while loose segments carry on', () => {
    const pages = paginate(
      [
        segment('loose-a', false, 2),
        segment('group-a', true, 2),
        segment('group-b', true, 2),
        segment('loose-b', false, 1),
      ],
      METRICS,
      { newPagePerHeaderedSegment: true },
    );

    expect(shape(pages)).toEqual([
      ['loose-a-0', 'loose-a-1'],
      ['group-a-0', 'group-a-1'],
      ['group-b-0', 'group-b-1', 'loose-b-0'],
    ]);
    expect(pages[2]?.segments.map(({ key }) => key)).toEqual(['group-b', 'loose-b']);
  });

  it('places exactly one strip per page when the container is narrower than a strip', () => {
    const narrow = { ...METRICS, containerWidth: 10 };

    expect(
      shape(paginate([segment('loose', false, 3)], narrow, { newPagePerHeaderedSegment: false })),
    ).toEqual([['loose-0'], ['loose-1'], ['loose-2']]);
    expect(
      shape(paginate([segment('inputs', true, 2)], narrow, { newPagePerHeaderedSegment: false })),
    ).toEqual([['inputs-0'], ['inputs-1']]);
  });

  it('returns no pages for no entries at all', () => {
    expect(paginate([], METRICS, { newPagePerHeaderedSegment: false })).toEqual([]);
    expect(
      paginate([segment('empty', true, 0)], METRICS, { newPagePerHeaderedSegment: true }),
    ).toEqual([]);
  });

  it('skips empty segments without spending a segment gap on them', () => {
    const pages = paginate(
      [segment('loose-a', false, 2), segment('empty', true, 0), segment('loose-b', false, 2)],
      METRICS,
      { newPagePerHeaderedSegment: false },
    );

    // 148 + 149 + 14 + 148 + 1 + 148 = 608 would overflow if the empty segment cost anything.
    expect(shape(pages)).toEqual([['loose-a-0', 'loose-a-1', 'loose-b-0'], ['loose-b-1']]);
    expect(pages[0]?.segments.map(({ key }) => key)).toEqual(['loose-a', 'loose-b']);
  });
});
