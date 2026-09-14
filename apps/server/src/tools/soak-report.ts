/**
 * What a soak run's samples mean, and whether the run passed.
 *
 * The question a soak answers is not "how much memory does it use" but "is it still the same
 * program an hour in". So every metric is read as a comparison between two windows of equal
 * length: one taken after the app has warmed up, one taken at the end. A number that is the same
 * in both is a program that has settled; a number that keeps climbing is a leak.
 */

export interface SoakBrowserSample {
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  domNodes: number;
  jsEventListeners: number;
  documents: number;
  frames: number;
  layoutCount: number;
  taskDurationS: number;
  wakeLock: string | null;
  pageLabel: string | null;
  strips: number;
  videos: number;
  /** Whether the header read `MIXER ONLINE` at this sample. */
  online: boolean;
}

export interface SoakServerSample {
  rssBytes: number;
  heapUsedBytes: number;
  activeHandles: number;
  listeners: Record<string, number>;
}

export type SoakChurnKind = 'ember' | 'socket';

export interface SoakChurnSample {
  kind: SoakChurnKind;
  /** How long the desk took to come back, or null if it had not by the deadline. */
  recoveredMs: number | null;
}

export interface SoakSample {
  /** Milliseconds since the run started. */
  atMs: number;
  browser: SoakBrowserSample;
  /** Null in attached mode: the server on the other end is not ours to measure. */
  server: SoakServerSample | null;
  churn?: SoakChurnSample;
}

export type SoakMode = 'default' | 'attached';

export interface SoakMetric {
  baseline: number;
  final: number;
  delta: number;
  /** `delta / baseline`, or zero when the baseline is zero and a ratio would say nothing. */
  ratio: number;
}

export interface SoakWindows {
  warmupMinutes: number;
  windowMinutes: number;
  baselineSamples: number;
  finalSamples: number;
  baselineFromMs: number;
  baselineToMs: number;
  finalFromMs: number;
  finalToMs: number;
  /** Whether two non-overlapping windows were available after the warm-up. */
  complete: boolean;
}

export interface SoakChurnSummary {
  total: number;
  byKind: Record<SoakChurnKind, number>;
  maxRecoveredMs: number | null;
  failures: number;
  events: Array<{ atMs: number; kind: SoakChurnKind; recoveredMs: number | null }>;
}

type BrowserMetricKey =
  | 'jsHeapUsedBytes'
  | 'jsHeapTotalBytes'
  | 'domNodes'
  | 'jsEventListeners'
  | 'documents'
  | 'frames'
  | 'layoutCount'
  | 'taskDurationS'
  | 'strips'
  | 'videos';

const BROWSER_METRIC_KEYS: BrowserMetricKey[] = [
  'jsHeapUsedBytes',
  'jsHeapTotalBytes',
  'domNodes',
  'jsEventListeners',
  'documents',
  'frames',
  'layoutCount',
  'taskDurationS',
  'strips',
  'videos',
];

export interface SoakSummary {
  mode: SoakMode;
  samples: number;
  durationMs: number;
  windows: SoakWindows;
  browser: Record<BrowserMetricKey, SoakMetric>;
  server: {
    rssBytes: SoakMetric;
    heapUsedBytes: SoakMetric;
    activeHandles: SoakMetric;
    listeners: Record<string, SoakMetric>;
  } | null;
  /** Least squares over every post-warm-up sample, in bytes per minute. */
  jsHeapSlopeBytesPerMin: number;
  churn: SoakChurnSummary;
  offline: { samples: number; firstAtMs: number | null };
  wakeLockStates: string[];
  pageLabels: string[];
}

export interface SoakVerdict {
  status: 'pass' | 'fail' | 'inconclusive';
  failures: string[];
  notes: string[];
}

/** How long the app is given to settle before any of its numbers are believed. */
export const SOAK_WARMUP_MINUTES = 10;
/** The length of the two windows that are compared. */
export const SOAK_WINDOW_MINUTES = 10;
export const SOAK_HEAP_GROWTH_MAX_BYTES = 10 * 1024 * 1024;
export const SOAK_HEAP_GROWTH_MAX_RATIO = 0.2;
export const SOAK_DRIFT_MAX_RATIO = 0.05;
export const SOAK_SERVER_HEAP_GROWTH_MAX_BYTES = 20 * 1024 * 1024;
export const SOAK_HANDLE_DRIFT_MAX = 4;
/** How long a desk has to come back after a churn before the run is called a failure. */
export const SOAK_CHURN_RECOVERY_MS = 30_000;

export interface SoakThresholds {
  heapGrowthMaxBytes: number;
  heapGrowthMaxRatio: number;
  driftMaxRatio: number;
  serverHeapGrowthMaxBytes: number;
  handleDriftMax: number;
  churnRecoveryMs: number;
}

export const SOAK_DEFAULT_THRESHOLDS: SoakThresholds = {
  heapGrowthMaxBytes: SOAK_HEAP_GROWTH_MAX_BYTES,
  heapGrowthMaxRatio: SOAK_HEAP_GROWTH_MAX_RATIO,
  driftMaxRatio: SOAK_DRIFT_MAX_RATIO,
  serverHeapGrowthMaxBytes: SOAK_SERVER_HEAP_GROWTH_MAX_BYTES,
  handleDriftMax: SOAK_HANDLE_DRIFT_MAX,
  churnRecoveryMs: SOAK_CHURN_RECOVERY_MS,
};

export interface SummarizeOptions {
  mode?: SoakMode;
  warmupMinutes?: number;
  windowMinutes?: number;
}

export interface SoakMeta {
  startedAt: string;
  finishedAt: string;
  mode: SoakMode;
  minutes: number;
  sampleSeconds: number;
  pageSeconds: number;
  churnMinutes: number;
  meterHz: number;
  browser: string;
  browserVersion?: string;
  url?: string;
  channels?: number;
  /** Which pages the operator was on during the run, as opposed to at the sampling instants. */
  pagesVisited?: string[];
  thresholds: SoakThresholds;
}

export function leastSquaresSlope(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) {
    return 0;
  }
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    covariance += dx * (point.y - meanY);
    variance += dx * dx;
  }
  return variance === 0 ? 0 : covariance / variance;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function metricOf(baselineValues: readonly number[], finalValues: readonly number[]): SoakMetric {
  const baseline = mean(baselineValues);
  const final = mean(finalValues);
  const delta = final - baseline;
  return { baseline, final, delta, ratio: baseline === 0 ? 0 : delta / baseline };
}

function summarizeChurn(samples: readonly SoakSample[]): SoakChurnSummary {
  const events = samples
    .filter(
      (sample): sample is SoakSample & { churn: SoakChurnSample } => sample.churn !== undefined,
    )
    .map((sample) => ({
      atMs: sample.atMs,
      kind: sample.churn.kind,
      recoveredMs: sample.churn.recoveredMs,
    }));
  const recovered = events
    .map((event) => event.recoveredMs)
    .filter((value): value is number => value !== null);
  return {
    total: events.length,
    byKind: {
      ember: events.filter((event) => event.kind === 'ember').length,
      socket: events.filter((event) => event.kind === 'socket').length,
    },
    maxRecoveredMs: recovered.length === 0 ? null : Math.max(...recovered),
    failures: events.filter((event) => event.recoveredMs === null).length,
    events,
  };
}

export function summarize(
  samples: readonly SoakSample[],
  options: SummarizeOptions = {},
): SoakSummary {
  const warmupMinutes = options.warmupMinutes ?? SOAK_WARMUP_MINUTES;
  const windowMinutes = options.windowMinutes ?? SOAK_WINDOW_MINUTES;
  const mode = options.mode ?? 'default';
  const warmupMs = warmupMinutes * 60_000;
  const windowMs = windowMinutes * 60_000;

  const ordered = [...samples].sort((left, right) => left.atMs - right.atMs);
  const afterWarmup = ordered.filter((sample) => sample.atMs >= warmupMs);
  const lastMs = ordered.at(-1)?.atMs ?? 0;

  let baseline = afterWarmup.filter((sample) => sample.atMs < warmupMs + windowMs);
  let final = afterWarmup.filter((sample) => sample.atMs > lastMs - windowMs);
  const complete =
    baseline.length > 0 && final.length > 0 && lastMs - windowMs >= warmupMs + windowMs;

  if (!complete) {
    /*
     * A run too short to hold two windows still deserves a report — a three minute smoke run has
     * to be readable — so the first and last samples stand in for the windows. The verdict reads
     * `complete` rather than the numbers, and calls a run like this inconclusive.
     */
    const first = ordered[0];
    const lastSample = ordered.at(-1);
    baseline = first === undefined ? [] : [first];
    final = lastSample === undefined ? [] : [lastSample];
  }

  const browserMetric = (key: BrowserMetricKey): SoakMetric =>
    metricOf(
      baseline.map((sample) => sample.browser[key]),
      final.map((sample) => sample.browser[key]),
    );
  const browser = Object.fromEntries(
    BROWSER_METRIC_KEYS.map((key) => [key, browserMetric(key)]),
  ) as Record<BrowserMetricKey, SoakMetric>;

  const hasServer = ordered.some((sample) => sample.server !== null);
  const serverValues = (
    window: readonly SoakSample[],
    pick: (sample: SoakServerSample) => number,
  ): number[] =>
    window
      .map((sample) => sample.server)
      .filter((sample): sample is SoakServerSample => sample !== null)
      .map(pick);

  const listenerKeys = new Set<string>();
  for (const sample of ordered) {
    for (const key of Object.keys(sample.server?.listeners ?? {})) {
      listenerKeys.add(key);
    }
  }
  const listenerValues = (window: readonly SoakSample[], key: string): number[] =>
    window
      .map((sample) => sample.server?.listeners[key])
      .filter((value): value is number => value !== undefined);

  const server = hasServer
    ? {
        rssBytes: metricOf(
          serverValues(baseline, (entry) => entry.rssBytes),
          serverValues(final, (entry) => entry.rssBytes),
        ),
        heapUsedBytes: metricOf(
          serverValues(baseline, (entry) => entry.heapUsedBytes),
          serverValues(final, (entry) => entry.heapUsedBytes),
        ),
        activeHandles: metricOf(
          serverValues(baseline, (entry) => entry.activeHandles),
          serverValues(final, (entry) => entry.activeHandles),
        ),
        listeners: Object.fromEntries(
          [...listenerKeys]
            .sort()
            .map((key) => [
              key,
              metricOf(listenerValues(baseline, key), listenerValues(final, key)),
            ]),
        ),
      }
    : null;

  const slopeSource = afterWarmup.length >= 2 ? afterWarmup : ordered;
  const offlineSamples = ordered.filter((sample) => !sample.browser.online);

  return {
    mode,
    samples: ordered.length,
    durationMs: lastMs,
    windows: {
      warmupMinutes,
      windowMinutes,
      baselineSamples: baseline.length,
      finalSamples: final.length,
      baselineFromMs: baseline[0]?.atMs ?? 0,
      baselineToMs: baseline.at(-1)?.atMs ?? 0,
      finalFromMs: final[0]?.atMs ?? 0,
      finalToMs: final.at(-1)?.atMs ?? 0,
      complete,
    },
    browser,
    server,
    jsHeapSlopeBytesPerMin: leastSquaresSlope(
      slopeSource.map((sample) => ({
        x: sample.atMs / 60_000,
        y: sample.browser.jsHeapUsedBytes,
      })),
    ),
    churn: summarizeChurn(ordered),
    offline: {
      samples: offlineSamples.length,
      firstAtMs: offlineSamples[0]?.atMs ?? null,
    },
    wakeLockStates: [
      ...new Set(
        ordered
          .map((sample) => sample.browser.wakeLock)
          .filter((value): value is string => value !== null),
      ),
    ],
    pageLabels: [
      ...new Set(
        ordered
          .map((sample) => sample.browser.pageLabel)
          .filter((value): value is string => value !== null),
      ),
    ],
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function verdict(
  summary: SoakSummary,
  thresholds: SoakThresholds = SOAK_DEFAULT_THRESHOLDS,
): SoakVerdict {
  const failures: string[] = [];
  const notes: string[] = [];

  /*
   * A desk that did not come back is a failure at any length. A ten minute run cannot tell you
   * whether memory is climbing, but it can tell you the mixer stayed dark after a reconnect, and
   * that answer does not improve with more samples.
   */
  for (const event of summary.churn.events) {
    if (event.recoveredMs === null) {
      failures.push(
        `the ${event.kind} churn at ${Math.round(event.atMs / 1000)}s never came back online`,
      );
    } else if (event.recoveredMs > thresholds.churnRecoveryMs) {
      failures.push(
        `the ${event.kind} churn at ${Math.round(event.atMs / 1000)}s took ${event.recoveredMs}ms ` +
          `to recover, over the ${thresholds.churnRecoveryMs}ms allowed`,
      );
    }
  }
  if (summary.mode === 'attached' && summary.offline.samples > 0) {
    failures.push(
      `the desk read offline at ${Math.round((summary.offline.firstAtMs ?? 0) / 1000)}s ` +
        `and for ${summary.offline.samples} sample(s) in total`,
    );
  }

  if (failures.length > 0) {
    return { status: 'fail', failures, notes };
  }

  if (!summary.windows.complete) {
    notes.push(
      `too short to compare two ${summary.windows.windowMinutes} minute windows after a ` +
        `${summary.windows.warmupMinutes} minute warm-up: a run needs at least ` +
        `${summary.windows.warmupMinutes + summary.windows.windowMinutes * 2} minutes. ` +
        'The figures below are the first and last samples, not window averages.',
    );
    return { status: 'inconclusive', failures, notes };
  }

  const heap = summary.browser.jsHeapUsedBytes;
  if (heap.delta > thresholds.heapGrowthMaxBytes) {
    failures.push(
      `the JS heap grew by ${formatMiB(heap.delta)}, over the ` +
        `${formatMiB(thresholds.heapGrowthMaxBytes)} allowed`,
    );
  }
  if (heap.ratio > thresholds.heapGrowthMaxRatio) {
    failures.push(
      `the JS heap grew by ${(heap.ratio * 100).toFixed(1)}%, over the ` +
        `${(thresholds.heapGrowthMaxRatio * 100).toFixed(1)}% allowed`,
    );
  }
  for (const key of ['domNodes', 'jsEventListeners'] as const) {
    const metric = summary.browser[key];
    if (Math.abs(metric.ratio) > thresholds.driftMaxRatio) {
      failures.push(
        `${key} drifted by ${(metric.ratio * 100).toFixed(1)}%, over the ` +
          `${(thresholds.driftMaxRatio * 100).toFixed(1)}% allowed`,
      );
    }
  }
  if (summary.server === null) {
    notes.push(
      'attached mode: the server is not ours to measure, so its heap and handle checks were ' +
        'not applied.',
    );
  } else {
    if (summary.server.heapUsedBytes.delta > thresholds.serverHeapGrowthMaxBytes) {
      failures.push(
        `the server heap grew by ${formatMiB(summary.server.heapUsedBytes.delta)}, over the ` +
          `${formatMiB(thresholds.serverHeapGrowthMaxBytes)} allowed`,
      );
    }
    if (Math.abs(summary.server.activeHandles.delta) > thresholds.handleDriftMax) {
      failures.push(
        `server handles drifted by ${summary.server.activeHandles.delta.toFixed(1)}, over the ` +
          `${thresholds.handleDriftMax} allowed`,
      );
    }
  }

  return { status: failures.length === 0 ? 'pass' : 'fail', failures, notes };
}

function formatValue(key: string, value: number): string {
  if (key.endsWith('Bytes')) {
    return formatMiB(value);
  }
  if (key.endsWith('S')) {
    return `${value.toFixed(2)} s`;
  }
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function metricRow(label: string, key: string, metric: SoakMetric): string {
  const change = `${metric.delta >= 0 ? '+' : ''}${formatValue(key, metric.delta)}`;
  const percent = `${metric.ratio >= 0 ? '+' : ''}${(metric.ratio * 100).toFixed(1)}%`;
  return `| ${label} | ${formatValue(key, metric.baseline)} | ${formatValue(key, metric.final)} | ${change} | ${percent} |`;
}

const BROWSER_LABELS: Record<BrowserMetricKey, string> = {
  jsHeapUsedBytes: 'JS heap used',
  jsHeapTotalBytes: 'JS heap total',
  domNodes: 'DOM nodes',
  jsEventListeners: 'JS event listeners',
  documents: 'Documents',
  frames: 'Frames',
  layoutCount: 'Layout count',
  taskDurationS: 'Task duration',
  strips: 'Channel strips',
  videos: 'Video elements',
};

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function renderMarkdown(summary: SoakSummary, result: SoakVerdict, meta: SoakMeta): string {
  const lines: string[] = [];
  lines.push('# Soak report');
  lines.push('');
  lines.push(`**Verdict: ${result.status.toUpperCase()}**`);
  lines.push('');

  lines.push('## Run');
  lines.push('');
  lines.push('| Setting | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Mode | ${meta.mode} |`);
  lines.push(`| Started | ${meta.startedAt} |`);
  lines.push(`| Finished | ${meta.finishedAt} |`);
  lines.push(`| Requested length | ${meta.minutes} min |`);
  lines.push(`| Measured length | ${minutes(summary.durationMs)} |`);
  lines.push(`| Samples | ${summary.samples} |`);
  lines.push(`| Sample interval | ${meta.sampleSeconds} s |`);
  lines.push(`| Page turn interval | ${meta.pageSeconds} s |`);
  lines.push(
    `| Churn interval | ${meta.churnMinutes === 0 ? 'off' : `${meta.churnMinutes} min`} |`,
  );
  lines.push(`| Meter rate | ${meta.meterHz} Hz |`);
  lines.push(
    `| Browser | ${meta.browser}${meta.browserVersion === undefined ? '' : ` (${meta.browserVersion})`} |`,
  );
  if (meta.url !== undefined) {
    lines.push(`| Attached to | ${meta.url} |`);
  }
  if (meta.channels !== undefined) {
    lines.push(`| Fed channels | ${meta.channels} |`);
  }
  lines.push('');

  lines.push('## Windows');
  lines.push('');
  if (summary.windows.complete) {
    lines.push(
      `Baseline is the first ${summary.windows.windowMinutes} minute window after a ` +
        `${summary.windows.warmupMinutes} minute warm-up ` +
        `(${minutes(summary.windows.baselineFromMs)} to ${minutes(summary.windows.baselineToMs)}, ` +
        `${summary.windows.baselineSamples} samples); final is the last window of the same length ` +
        `(${minutes(summary.windows.finalFromMs)} to ${minutes(summary.windows.finalToMs)}, ` +
        `${summary.windows.finalSamples} samples).`,
    );
  } else {
    lines.push(
      'This run was too short to hold two windows, so the figures below are the first and last ' +
        'samples rather than window averages.',
    );
  }
  lines.push('');

  lines.push('## Browser');
  lines.push('');
  lines.push('| Metric | Baseline | Final | Change | Change % |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const key of BROWSER_METRIC_KEYS) {
    lines.push(metricRow(BROWSER_LABELS[key], key, summary.browser[key]));
  }
  lines.push('');
  lines.push(
    `JS heap slope after warm-up: ${(summary.jsHeapSlopeBytesPerMin / 1024).toFixed(1)} KiB/min.`,
  );
  lines.push('');
  lines.push(
    `Wake lock states seen: ${summary.wakeLockStates.join(', ') || 'none'}. ` +
      `Page labels at the sampling instants: ${summary.pageLabels.join(', ') || 'none'}.`,
  );
  if (meta.pagesVisited !== undefined) {
    lines.push('');
    lines.push(
      `Pages the operator turned to during the run: ${meta.pagesVisited.join(', ')}. ` +
        'A sample interval that is a multiple of the page interval lands on the same phase every ' +
        'time, so the line above can name a single page even while the pager is working.',
    );
  }
  lines.push('');

  lines.push('## Server');
  lines.push('');
  if (summary.server === null) {
    lines.push(
      'Not applicable. Attached mode measures a server this run did not start, so nothing here ' +
        'was read and the server thresholds were not applied. The tool only turned pages and read ' +
        'the DOM: it sent no control event of any kind.',
    );
  } else {
    lines.push('| Metric | Baseline | Final | Change | Change % |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    lines.push(metricRow('RSS', 'rssBytes', summary.server.rssBytes));
    lines.push(metricRow('Heap used', 'heapUsedBytes', summary.server.heapUsedBytes));
    lines.push(metricRow('Active handles', 'activeHandles', summary.server.activeHandles));
    for (const [key, metric] of Object.entries(summary.server.listeners)) {
      lines.push(metricRow(`Listeners: ${key}`, key, metric));
    }
  }
  lines.push('');

  lines.push('## Churn');
  lines.push('');
  if (summary.churn.total === 0) {
    lines.push('No churn was performed.');
  } else {
    lines.push(
      `${summary.churn.total} events (${summary.churn.byKind.ember} Ember, ` +
        `${summary.churn.byKind.socket} socket); slowest recovery ` +
        `${summary.churn.maxRecoveredMs === null ? 'n/a' : `${summary.churn.maxRecoveredMs} ms`}; ` +
        `${summary.churn.failures} never recovered.`,
    );
    lines.push('');
    lines.push('| At | Kind | Recovered |');
    lines.push('| ---: | --- | ---: |');
    for (const event of summary.churn.events) {
      lines.push(
        `| ${minutes(event.atMs)} | ${event.kind} | ` +
          `${event.recoveredMs === null ? 'never' : `${event.recoveredMs} ms`} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Verdict');
  lines.push('');
  lines.push(`Status: **${result.status}**.`);
  if (result.failures.length > 0) {
    lines.push('');
    lines.push('Failed checks:');
    for (const failure of result.failures) {
      lines.push(`- ${failure}`);
    }
  }
  if (result.notes.length > 0) {
    lines.push('');
    lines.push('Notes:');
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push('| Check | Limit |');
  lines.push('| --- | ---: |');
  lines.push(`| JS heap growth | ${formatMiB(meta.thresholds.heapGrowthMaxBytes)} |`);
  lines.push(
    `| JS heap growth ratio | ${(meta.thresholds.heapGrowthMaxRatio * 100).toFixed(1)}% |`,
  );
  lines.push(`| DOM and listener drift | ${(meta.thresholds.driftMaxRatio * 100).toFixed(1)}% |`);
  lines.push(`| Server heap growth | ${formatMiB(meta.thresholds.serverHeapGrowthMaxBytes)} |`);
  lines.push(`| Server handle drift | ${meta.thresholds.handleDriftMax} |`);
  lines.push(`| Churn recovery | ${meta.thresholds.churnRecoveryMs} ms |`);
  lines.push('');

  return lines.join('\n');
}
