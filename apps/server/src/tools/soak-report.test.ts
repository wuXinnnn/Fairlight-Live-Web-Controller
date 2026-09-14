import { describe, expect, it } from 'vitest';
import {
  leastSquaresSlope,
  renderMarkdown,
  SOAK_DEFAULT_THRESHOLDS,
  SOAK_WARMUP_MINUTES,
  SOAK_WINDOW_MINUTES,
  summarize,
  verdict,
  type SoakMeta,
  type SoakSample,
  type SoakThresholds,
} from './soak-report.js';

const MINUTE = 60_000;
const MiB = 1024 * 1024;

interface SampleOverrides {
  jsHeapUsedBytes?: number;
  domNodes?: number;
  jsEventListeners?: number;
  online?: boolean;
  serverHeapUsedBytes?: number;
  activeHandles?: number;
  server?: null;
  churn?: SoakSample['churn'];
}

function sampleAt(atMs: number, overrides: SampleOverrides = {}): SoakSample {
  const sample: SoakSample = {
    atMs,
    browser: {
      jsHeapUsedBytes: overrides.jsHeapUsedBytes ?? 40 * MiB,
      jsHeapTotalBytes: 60 * MiB,
      domNodes: overrides.domNodes ?? 1000,
      jsEventListeners: overrides.jsEventListeners ?? 200,
      documents: 1,
      frames: 1,
      layoutCount: 50,
      taskDurationS: 1.5,
      wakeLock: 'active',
      pageLabel: '1 / 2',
      strips: 20,
      videos: 1,
      online: overrides.online ?? true,
    },
    server:
      overrides.server === null
        ? null
        : {
            rssBytes: 120 * MiB,
            heapUsedBytes: overrides.serverHeapUsedBytes ?? 30 * MiB,
            activeHandles: overrides.activeHandles ?? 12,
            listeners: { status: 1, tree: 1, patch: 1, snapshot: 1 },
          },
  };
  if (overrides.churn !== undefined) {
    sample.churn = overrides.churn;
  }
  return sample;
}

/** A run long enough to hold both windows, every 30 s, with the end shifted by `overrides`. */
function runOf(minutes: number, endOverrides: SampleOverrides = {}): SoakSample[] {
  const samples: SoakSample[] = [];
  const lastMs = minutes * MINUTE;
  for (let atMs = 0; atMs <= lastMs; atMs += 30_000) {
    // Anything in the closing window gets the end values; everything before keeps the defaults.
    const inFinalWindow = atMs > lastMs - SOAK_WINDOW_MINUTES * MINUTE;
    samples.push(sampleAt(atMs, inFinalWindow ? endOverrides : {}));
  }
  return samples;
}

const meta: SoakMeta = {
  startedAt: '2026-09-15T00:00:00.000Z',
  finishedAt: '2026-09-15T01:00:00.000Z',
  mode: 'default',
  minutes: 60,
  sampleSeconds: 30,
  pageSeconds: 5,
  churnMinutes: 10,
  meterHz: 20,
  browser: 'chrome.exe',
  browserVersion: '151.0.7922.176',
  channels: 20,
  thresholds: SOAK_DEFAULT_THRESHOLDS,
};

describe('leastSquaresSlope', () => {
  it('recovers the slope of a straight line', () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 10 + 3 * x }));
    expect(leastSquaresSlope(points)).toBeCloseTo(3, 10);
  });

  it('is zero for a flat line', () => {
    expect(leastSquaresSlope([0, 1, 2].map((x) => ({ x, y: 7 })))).toBe(0);
  });

  it('is zero when there is nothing to fit', () => {
    expect(leastSquaresSlope([])).toBe(0);
    expect(leastSquaresSlope([{ x: 1, y: 2 }])).toBe(0);
    expect(
      leastSquaresSlope([
        { x: 1, y: 2 },
        { x: 1, y: 9 },
      ]),
    ).toBe(0);
  });
});

describe('summarize windows', () => {
  it('reports nothing measurable for no samples at all', () => {
    const summary = summarize([]);
    expect(summary.samples).toBe(0);
    expect(summary.windows.complete).toBe(false);
    expect(summary.browser.jsHeapUsedBytes).toEqual({
      baseline: 0,
      final: 0,
      delta: 0,
      ratio: 0,
    });
  });

  it('splits a sixty minute run into the first and last window after the warm-up', () => {
    const summary = summarize(runOf(60));
    expect(summary.windows.complete).toBe(true);
    // 10 to 20 minutes, every 30 s, the upper edge excluded.
    expect(summary.windows.baselineFromMs).toBe(SOAK_WARMUP_MINUTES * MINUTE);
    expect(summary.windows.baselineToMs).toBe(19.5 * MINUTE);
    expect(summary.windows.baselineSamples).toBe(20);
    // 50 to 60 minutes, the lower edge excluded.
    expect(summary.windows.finalFromMs).toBe(50.5 * MINUTE);
    expect(summary.windows.finalToMs).toBe(60 * MINUTE);
    expect(summary.windows.finalSamples).toBe(20);
  });

  it('treats the shortest run that holds two windows as complete', () => {
    // Warm-up plus two windows exactly: the boundary case.
    expect(summarize(runOf(SOAK_WARMUP_MINUTES + SOAK_WINDOW_MINUTES * 2)).windows.complete).toBe(
      true,
    );
    expect(
      summarize(runOf(SOAK_WARMUP_MINUTES + SOAK_WINDOW_MINUTES * 2 - 1)).windows.complete,
    ).toBe(false);
  });

  it('falls back to the first and last sample when the run is all warm-up', () => {
    const samples = [
      sampleAt(0, { jsHeapUsedBytes: 10 * MiB }),
      sampleAt(180_000, { jsHeapUsedBytes: 12 * MiB }),
    ];
    const summary = summarize(samples);
    expect(summary.windows.complete).toBe(false);
    expect(summary.browser.jsHeapUsedBytes.baseline).toBe(10 * MiB);
    expect(summary.browser.jsHeapUsedBytes.final).toBe(12 * MiB);
  });

  it('averages the values inside each window', () => {
    const samples = runOf(60, { jsHeapUsedBytes: 44 * MiB, domNodes: 1010 });
    const summary = summarize(samples);
    expect(summary.browser.jsHeapUsedBytes.baseline).toBe(40 * MiB);
    expect(summary.browser.jsHeapUsedBytes.final).toBe(44 * MiB);
    expect(summary.browser.jsHeapUsedBytes.delta).toBe(4 * MiB);
    expect(summary.browser.jsHeapUsedBytes.ratio).toBeCloseTo(0.1, 10);
    expect(summary.browser.domNodes.delta).toBe(10);
  });

  it('reads samples that arrive out of order in time order', () => {
    const ordered = runOf(60);
    const shuffled = [...ordered].reverse();
    expect(summarize(shuffled).windows).toEqual(summarize(ordered).windows);
  });

  it('says nothing about a ratio it cannot compute', () => {
    const samples = runOf(60).map((sample) => ({
      ...sample,
      browser: { ...sample.browser, videos: 0 },
    }));
    expect(summarize(samples).browser.videos.ratio).toBe(0);
  });

  it('collects the server listener counts by name', () => {
    const summary = summarize(runOf(60));
    expect(Object.keys(summary.server?.listeners ?? {})).toEqual([
      'patch',
      'snapshot',
      'status',
      'tree',
    ]);
    expect(summary.server?.listeners.status?.delta).toBe(0);
  });

  it('leaves the server out when no sample carried one', () => {
    const summary = summarize(runOf(60).map((sample) => ({ ...sample, server: null })));
    expect(summary.server).toBeNull();
  });

  it('counts the churn events and the samples that read offline', () => {
    const samples = runOf(60);
    samples[30] = sampleAt(15 * MINUTE, { churn: { kind: 'ember', recoveredMs: 1200 } });
    samples[60] = sampleAt(30 * MINUTE, {
      churn: { kind: 'socket', recoveredMs: 800 },
      online: false,
    });
    const summary = summarize(samples);
    expect(summary.churn.total).toBe(2);
    expect(summary.churn.byKind).toEqual({ ember: 1, socket: 1 });
    expect(summary.churn.maxRecoveredMs).toBe(1200);
    expect(summary.churn.failures).toBe(0);
    expect(summary.offline.samples).toBe(1);
    expect(summary.offline.firstAtMs).toBe(30 * MINUTE);
  });

  it('reports no recovery time when every churn failed', () => {
    const samples = runOf(60);
    samples[30] = sampleAt(15 * MINUTE, { churn: { kind: 'ember', recoveredMs: null } });
    const summary = summarize(samples);
    expect(summary.churn.maxRecoveredMs).toBeNull();
    expect(summary.churn.failures).toBe(1);
  });

  it('measures the heap slope over the samples after the warm-up', () => {
    const samples: SoakSample[] = [];
    for (let minute = 0; minute <= 40; minute += 1) {
      // Flat through the warm-up, then a clean 1 MiB per minute.
      const heap = minute < SOAK_WARMUP_MINUTES ? 99 * MiB : 40 * MiB + (minute - 10) * MiB;
      samples.push(sampleAt(minute * MINUTE, { jsHeapUsedBytes: heap }));
    }
    expect(summarize(samples).jsHeapSlopeBytesPerMin).toBeCloseTo(MiB, 0);
  });
});

describe('verdict', () => {
  it('passes a run that stayed where it started', () => {
    expect(verdict(summarize(runOf(60)))).toEqual({ status: 'pass', failures: [], notes: [] });
  });

  it('accepts growth that lands exactly on a threshold', () => {
    const summary = summarize(
      runOf(60, { jsHeapUsedBytes: 40 * MiB + SOAK_DEFAULT_THRESHOLDS.heapGrowthMaxBytes }),
    );
    // 10 MiB on a 40 MiB baseline is 25%, so the ratio has to be relaxed to isolate the byte check.
    expect(verdict(summary, { ...SOAK_DEFAULT_THRESHOLDS, heapGrowthMaxRatio: 0.25 }).status).toBe(
      'pass',
    );
  });

  it('fails growth one byte past the threshold', () => {
    const summary = summarize(
      runOf(60, { jsHeapUsedBytes: 40 * MiB + SOAK_DEFAULT_THRESHOLDS.heapGrowthMaxBytes + 1 }),
    );
    const result = verdict(summary, { ...SOAK_DEFAULT_THRESHOLDS, heapGrowthMaxRatio: 1 });
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/JS heap grew by/);
  });

  it('fails a heap that grew by too large a share of itself', () => {
    const summary = summarize(runOf(60, { jsHeapUsedBytes: 48.5 * MiB }));
    const result = verdict(summary, { ...SOAK_DEFAULT_THRESHOLDS, heapGrowthMaxBytes: 1024 * MiB });
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/%/);
  });

  it('accepts drift exactly on the limit and fails it just past', () => {
    const limit = SOAK_DEFAULT_THRESHOLDS.driftMaxRatio;
    expect(verdict(summarize(runOf(60, { domNodes: 1000 * (1 + limit) }))).status).toBe('pass');
    expect(verdict(summarize(runOf(60, { domNodes: 1000 * (1 + limit) + 1 }))).status).toBe('fail');
  });

  it('treats a drop in DOM nodes as drift too', () => {
    const result = verdict(summarize(runOf(60, { domNodes: 800 })));
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/domNodes drifted/);
  });

  it('fails listeners that drifted past the limit', () => {
    const limit = SOAK_DEFAULT_THRESHOLDS.driftMaxRatio;
    const result = verdict(summarize(runOf(60, { jsEventListeners: 200 * (1 + limit) + 1 })));
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/jsEventListeners drifted/);
  });

  it('checks the server heap and handle count', () => {
    const grown = verdict(
      summarize(
        runOf(60, {
          serverHeapUsedBytes: 30 * MiB + SOAK_DEFAULT_THRESHOLDS.serverHeapGrowthMaxBytes + 1,
        }),
      ),
    );
    expect(grown.status).toBe('fail');
    expect(grown.failures.join()).toMatch(/server heap grew/);

    const onLimit = verdict(
      summarize(
        runOf(60, {
          serverHeapUsedBytes: 30 * MiB + SOAK_DEFAULT_THRESHOLDS.serverHeapGrowthMaxBytes,
        }),
      ),
    );
    expect(onLimit.status).toBe('pass');

    const handles = verdict(
      summarize(runOf(60, { activeHandles: 12 + SOAK_DEFAULT_THRESHOLDS.handleDriftMax + 1 })),
    );
    expect(handles.status).toBe('fail');
    expect(handles.failures.join()).toMatch(/server handles drifted/);

    expect(
      verdict(summarize(runOf(60, { activeHandles: 12 + SOAK_DEFAULT_THRESHOLDS.handleDriftMax })))
        .status,
    ).toBe('pass');
  });

  it('is inconclusive about a run too short to compare', () => {
    const result = verdict(summarize([sampleAt(0), sampleAt(180_000)]));
    expect(result.status).toBe('inconclusive');
    expect(result.failures).toEqual([]);
    expect(result.notes.join()).toMatch(/too short/);
  });

  it('fails a churn that never came back however short the run', () => {
    const result = verdict(
      summarize([sampleAt(0), sampleAt(120_000, { churn: { kind: 'socket', recoveredMs: null } })]),
    );
    // Length cannot excuse a mixer that stayed dark, so this outranks being inconclusive.
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/never came back/);
  });

  it('fails a churn that came back too slowly', () => {
    const slow = SOAK_DEFAULT_THRESHOLDS.churnRecoveryMs + 1;
    const samples = runOf(60);
    samples[30] = sampleAt(15 * MINUTE, { churn: { kind: 'ember', recoveredMs: slow } });
    const result = verdict(summarize(samples));
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/to recover/);
  });

  it('accepts a recovery exactly on the deadline', () => {
    const samples = runOf(60);
    samples[30] = sampleAt(15 * MINUTE, {
      churn: { kind: 'ember', recoveredMs: SOAK_DEFAULT_THRESHOLDS.churnRecoveryMs },
    });
    expect(verdict(summarize(samples)).status).toBe('pass');
  });

  it('skips the server checks in attached mode and says so', () => {
    const summary = summarize(
      runOf(60, { server: null, serverHeapUsedBytes: 0 }).map((sample) => ({
        ...sample,
        server: null,
      })),
      { mode: 'attached' },
    );
    const result = verdict(summary);
    expect(result.status).toBe('pass');
    expect(result.notes.join()).toMatch(/attached mode/);
  });

  it('fails an attached run whose desk went offline', () => {
    const samples = runOf(60).map((sample) => ({ ...sample, server: null }));
    samples[20] = { ...sampleAt(10 * MINUTE, { online: false, server: null }), server: null };
    const result = verdict(summarize(samples, { mode: 'attached' }));
    expect(result.status).toBe('fail');
    expect(result.failures.join()).toMatch(/read offline/);
  });
});

describe('renderMarkdown', () => {
  it('states the verdict, the numbers and the thresholds', () => {
    const summary = summarize(runOf(60));
    const markdown = renderMarkdown(summary, verdict(summary), meta);
    expect(markdown).toMatch(/\*\*Verdict: PASS\*\*/);
    expect(markdown).toMatch(/\| JS heap used \|/);
    expect(markdown).toMatch(/JS heap slope after warm-up/);
    expect(markdown).toMatch(/151\.0\.7922\.176/);
    expect(markdown).toMatch(/\| Churn recovery \| 30000 ms \|/);
  });

  it('lists every failed check', () => {
    const summary = summarize(runOf(60, { domNodes: 2000, jsEventListeners: 400 }));
    const result = verdict(summary);
    const markdown = renderMarkdown(summary, result, meta);
    expect(result.failures.length).toBeGreaterThan(1);
    for (const failure of result.failures) {
      expect(markdown).toContain(failure);
    }
  });

  it('renders one row per churn event', () => {
    const samples = runOf(60);
    samples[20] = sampleAt(10 * MINUTE, { churn: { kind: 'ember', recoveredMs: 900 } });
    samples[40] = sampleAt(20 * MINUTE, { churn: { kind: 'socket', recoveredMs: null } });
    const summary = summarize(samples);
    const markdown = renderMarkdown(summary, verdict(summary), meta);
    expect(markdown).toMatch(/\| ember \| 900 ms \|/);
    expect(markdown).toMatch(/\| socket \| never \|/);
  });

  it('says the churn section is empty when nothing was churned', () => {
    const summary = summarize(runOf(60));
    expect(renderMarkdown(summary, verdict(summary), meta)).toMatch(/No churn was performed/);
  });

  it('explains the missing server section in attached mode, and that it wrote nothing', () => {
    const samples = runOf(60).map((sample) => ({ ...sample, server: null }));
    const summary = summarize(samples, { mode: 'attached' });
    const markdown = renderMarkdown(summary, verdict(summary), {
      ...meta,
      mode: 'attached',
      url: 'http://127.0.0.1:5173/',
    });
    expect(markdown).toMatch(/sent no control event of any kind/);
    expect(markdown).toMatch(/http:\/\/127\.0\.0\.1:5173\//);
  });

  it('warns in the report when the run was too short to compare windows', () => {
    const summary = summarize([sampleAt(0), sampleAt(180_000)]);
    const markdown = renderMarkdown(summary, verdict(summary), { ...meta, minutes: 3 });
    expect(markdown).toMatch(/\*\*Verdict: INCONCLUSIVE\*\*/);
    expect(markdown).toMatch(/too short to hold two windows/);
  });

  it('names the pages the operator turned to, separately from the sampled ones', () => {
    const summary = summarize(runOf(60));
    const markdown = renderMarkdown(summary, verdict(summary), {
      ...meta,
      pagesVisited: ['1 / 2', '2 / 2'],
    });
    expect(markdown).toMatch(/Pages the operator turned to during the run: 1 \/ 2, 2 \/ 2/);
    expect(markdown).toMatch(/lands on the same phase/);
  });

  it('leaves the pager line out when nothing recorded a page turn', () => {
    const summary = summarize(runOf(60));
    expect(renderMarkdown(summary, verdict(summary), meta)).not.toMatch(
      /Pages the operator turned to/,
    );
  });

  it('renders custom thresholds rather than the defaults', () => {
    const thresholds: SoakThresholds = { ...SOAK_DEFAULT_THRESHOLDS, churnRecoveryMs: 5000 };
    const summary = summarize(runOf(60));
    const markdown = renderMarkdown(summary, verdict(summary, thresholds), { ...meta, thresholds });
    expect(markdown).toMatch(/\| Churn recovery \| 5000 ms \|/);
  });
});
