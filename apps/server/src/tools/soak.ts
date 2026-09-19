/**
 * The soak driver: an hour of the mixer running as it would on a show night, measured.
 *
 * Two modes. The default one builds the whole stack — a mock provider fed a synthetic programme,
 * the real server hosting the production build, a headless Chrome on the page — and pulls the
 * network out from under it every so often to check it comes back. The attached mode (`--url`)
 * starts nothing: it opens a browser on an address you already have and only reads. That is the
 * mode for measuring a session against the real desk, and it is read-only by construction, which
 * `runOperator` and `readPage` below are written to keep true.
 *
 * Excluded from coverage: this is the orchestration, and everything it decides lives in `cdp.ts`,
 * `soak-signal.ts` and `soak-report.ts`, which are tested.
 */
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findFreePort,
  loadDumpTree,
  MockEmberProvider,
  resolveLatestDumpPath,
} from '@flwc/test-utils';
import { start, type StartedServer } from '../server.js';
import { resolveWebDist } from '../paths.js';
import {
  parseSoakArgs,
  SOAK_CHURN_INTERVAL_MINUTES,
  SOAK_DEFAULT_MINUTES,
  SOAK_METER_HZ,
  SOAK_PAGE_TURN_INTERVAL_S,
  SOAK_SAMPLE_INTERVAL_S,
} from './cli-args.js';
import { connectCdp, launchChrome, resolveChromeExecutable, type CdpConnection } from './cdp.js';
import { resolveRepoPath } from './repo-paths.js';
import { collectMeterPaths, loudnessSignal, meterSignal } from './soak-signal.js';
import {
  renderMarkdown,
  SOAK_CHURN_RECOVERY_MS,
  SOAK_DEFAULT_THRESHOLDS,
  summarize,
  verdict,
  type SoakChurnKind,
  type SoakMode,
  type SoakSample,
  type SoakServerSample,
} from './soak-report.js';

export {
  SOAK_CHURN_INTERVAL_MINUTES,
  SOAK_DEFAULT_MINUTES,
  SOAK_METER_HZ,
  SOAK_PAGE_TURN_INTERVAL_S,
  SOAK_SAMPLE_INTERVAL_S,
};

/** How long a provider stays away before it comes back on the port it left. */
export const SOAK_EMBER_OUTAGE_MS = 5_000;
/** How often the run loop wakes to see whether anything is due. */
export const SOAK_TICK_MS = 250;
/** How often the page is asked whether the desk is back after a churn. */
export const SOAK_RECOVERY_POLL_MS = 500;
/**
 * How long a churn is given to show up on screen before the recovery is timed. A client that has
 * lost its transport needs a moment to notice, and timing a recovery from before it noticed would
 * measure the polling rather than the mixer.
 */
export const SOAK_OUTAGE_OBSERVE_MS = 4_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Everything the page is asked, in one expression that only reads.
 *
 * It is a fixed string with nothing interpolated into it, it calls nothing of the app's own, and
 * every term is a property read or a length. There is no path from here to a control event, which
 * is what makes the attached mode safe to point at a live desk.
 */
const PAGE_PROBE = `(() => {
  const shell = document.querySelector('.mixer-shell');
  const page = document.querySelector('output[aria-label="Page"]');
  return JSON.stringify({
    wakeLock: shell ? shell.getAttribute('data-wake-lock') : null,
    pageLabel: page ? page.textContent : null,
    strips: document.querySelectorAll('.channel-strip').length,
    videos: document.querySelectorAll('video').length,
    online: document.body.textContent.includes('MIXER ONLINE'),
    bodyFocused: document.activeElement === document.body,
  });
})()`;

interface PageReading {
  wakeLock: string | null;
  pageLabel: string | null;
  strips: number;
  videos: number;
  online: boolean;
  bodyFocused: boolean;
}

async function readPage(cdp: CdpConnection): Promise<PageReading> {
  const result = await cdp.send<{ result?: { value?: string } }>('Runtime.evaluate', {
    expression: PAGE_PROBE,
    returnByValue: true,
  });
  const raw = result.result?.value;
  if (typeof raw !== 'string') {
    throw new Error('the page probe returned nothing readable');
  }
  return JSON.parse(raw) as PageReading;
}

async function readMetrics(cdp: CdpConnection): Promise<Record<string, number>> {
  const result = await cdp.send<{ metrics?: Array<{ name: string; value: number }> }>(
    'Performance.getMetrics',
  );
  return Object.fromEntries((result.metrics ?? []).map((metric) => [metric.name, metric.value]));
}

function readServer(server: StartedServer | undefined): SoakServerSample | null {
  if (server === undefined) {
    return null;
  }
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    activeHandles: process.getActiveResourcesInfo().length,
    listeners: {
      status: server.runtime.ember.listenerCount('status'),
      tree: server.runtime.ember.listenerCount('tree'),
      patch: server.runtime.store.listenerCount('patch'),
      snapshot: server.runtime.store.listenerCount('snapshot'),
    },
  };
}

/** Waits for the header to read what `want` asks for, and says how long it took. */
async function waitForOnlineState(
  cdp: CdpConnection,
  want: boolean,
  timeoutMs: number,
): Promise<number | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await readPage(cdp)).online === want) {
        return Date.now() - startedAt;
      }
    } catch {
      // A probe that fails mid-reload is not an answer either way; try again.
    }
    await delay(SOAK_RECOVERY_POLL_MS);
  }
  return null;
}

/** Waits for the header to read `MIXER ONLINE`, and says how long it took. */
async function waitForOnline(cdp: CdpConnection, timeoutMs: number): Promise<number | null> {
  return waitForOnlineState(cdp, true, timeoutMs);
}

interface LocalStack {
  server: StartedServer;
  provider: MockEmberProvider;
  url: string;
  configDir: string;
  meterPaths: string[];
}

async function buildStack(dumpPath: string): Promise<LocalStack> {
  const staticRoot = resolveWebDist();
  if (!existsSync(path.join(staticRoot, 'index.html'))) {
    throw new Error(`no production build at ${staticRoot}. Run \`pnpm build\` first.`);
  }
  const dump = loadDumpTree(dumpPath);
  const provider = MockEmberProvider.fromDump(dump);
  const { host, port } = await provider.listen();
  let configDir: string | undefined;
  try {
    configDir = await mkdtemp(path.join(tmpdir(), 'flwc-soak-'));
    await writeFile(
      path.join(configDir, 'config.json'),
      `${JSON.stringify({ version: 1, ember: { host, port }, views: [] }, null, 2)}\n`,
      'utf8',
    );
    const httpPort = await findFreePort('127.0.0.1');
    // Default Ember timings on purpose, the once-a-minute strip probe included: building and
    // tearing down that probe client is one of the things worth soaking.
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      staticRoot,
      configDir,
      silent: true,
      emberSeed: null,
    });
    return {
      server,
      provider,
      url: `http://127.0.0.1:${httpPort}/`,
      configDir,
      meterPaths: collectMeterPaths(dump),
    };
  } catch (error) {
    /*
     * The caller has nothing to close until this returns. A provider left listening here would
     * keep the process alive after the error had been printed, with no run behind it to report.
     */
    provider.close();
    if (configDir !== undefined) {
      await rm(configDir, { recursive: true, force: true });
    }
    throw error;
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseSoakArgs(argv);
  const mode: SoakMode = args.url === undefined ? 'default' : 'attached';
  const startedAt = new Date();
  const outDir = resolveRepoPath(
    args.out ?? path.join('soak-reports', startedAt.toISOString().replace(/[:.]/g, '-')),
  );
  await mkdir(outDir, { recursive: true });

  const samples: SoakSample[] = [];
  const controller = new AbortController();
  let stack: LocalStack | undefined;
  let browser: { kill(): void } | undefined;
  let cdp: CdpConnection | undefined;
  let meterTimer: NodeJS.Timeout | undefined;
  let loudnessTimer: NodeJS.Timeout | undefined;
  let userDataDir: string | undefined;
  let torndown = false;
  /*
   * Which pages the operator has actually been on. A sample only sees where the desk is at that
   * instant, and with a sample interval that is a multiple of the page interval every sample
   * lands on the same phase and reports the same page forever. That is aliasing, not a stuck
   * pager, so what the pager did between samples is recorded here and reported separately.
   */
  const pagesVisited = new Set<string>();
  /*
   * What cut the run short, if anything did. A browser that crashes at minute fifty-nine has
   * still left fifty-nine minutes of samples on disk, and they deserve the same report a run
   * stopped with Ctrl+C gets; the error is printed after it and the exit code says the run was
   * not a clean one.
   */
  let runError: unknown;

  const persist = async (): Promise<void> => {
    // Written whole to a temporary name and moved into place, so a run killed mid-write leaves a
    // readable file rather than half of one.
    const target = path.join(outDir, 'samples.json');
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(samples, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  };

  /**
   * Each step is attempted on its own. A run that has an hour of samples behind it must not lose
   * its report because a temporary directory would not delete: on Windows the browser profile is
   * still locked for a moment after the process goes, and that is nobody's problem but its own.
   */
  const attempt = async (what: string, step: () => void | Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      console.error(`soak: could not ${what}: ${error instanceof Error ? error.message : error}`);
    }
  };

  const teardown = async (): Promise<void> => {
    if (torndown) {
      return;
    }
    torndown = true;
    clearInterval(meterTimer);
    clearInterval(loudnessTimer);
    await attempt('stop the browser', () => browser?.kill());
    await attempt('close the CDP connection', () => cdp?.close());
    if (stack !== undefined) {
      const live = stack;
      await attempt('close the server', () => live.server.app.close());
      await attempt('close the provider', () => live.provider.close());
      await attempt('remove the config directory', () =>
        rm(live.configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
      );
    }
    if (userDataDir !== undefined) {
      const profile = userDataDir;
      await attempt('remove the browser profile', () =>
        rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }),
      );
    }
  };

  const stop = (): void => {
    if (!controller.signal.aborted) {
      console.error('\nstopping, the report will still be written');
      controller.abort();
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const dumpPath = args.dump === undefined ? resolveLatestDumpPath() : resolveRepoPath(args.dump);
    let pageUrl = args.url ?? '';
    if (mode === 'default') {
      stack = await buildStack(dumpPath);
      pageUrl = stack.url;
      const feedStartedAt = Date.now();
      const live = stack;
      meterTimer = setInterval(() => {
        const t = (Date.now() - feedStartedAt) / 1000;
        live.meterPaths.forEach((meterPath, index) => {
          live.provider.pushParameter(meterPath, meterSignal(t, index));
        });
      }, 1000 / args.meterHz);
      loudnessTimer = setInterval(() => {
        const t = (Date.now() - feedStartedAt) / 1000;
        const loudness = loudnessSignal(t, live.meterPaths.length);
        live.provider.pushParameter('system/loudness/integrated', loudness.integratedLufs);
        live.provider.pushParameter('system/loudness/true-peak', loudness.truePeakDbtp);
      }, 1000);
      console.error(
        `soak: serving ${live.url} with ${live.meterPaths.length} metered channels at ${args.meterHz} Hz`,
      );
    } else {
      console.error(`soak: attaching to ${pageUrl} read-only; no control event will be sent`);
    }

    const executable = resolveChromeExecutable(args.browser);
    userDataDir = await mkdtemp(path.join(tmpdir(), 'flwc-soak-profile-'));
    const chrome = await launchChrome({
      executable,
      url: pageUrl,
      userDataDir,
      args: args.browserArgs,
    });
    browser = chrome;
    cdp = await connectCdp(chrome.pageSocketUrl);
    const connection = cdp;
    await connection.send('Performance.enable');
    await connection.send('HeapProfiler.enable');
    await connection.send('Runtime.enable');

    const cameOnline = await waitForOnline(connection, SOAK_CHURN_RECOVERY_MS);
    if (cameOnline === null) {
      throw new Error(`the page never read MIXER ONLINE within ${SOAK_CHURN_RECOVERY_MS}ms`);
    }
    console.error(`soak: online after ${cameOnline}ms; running for ${args.minutes} min`);

    const runStartedAt = Date.now();
    const deadline = runStartedAt + args.minutes * 60_000;
    let pendingChurn: SoakSample['churn'];
    let churnIndex = 0;
    let goingForward = true;

    const turnPage = async (): Promise<void> => {
      // Page keys move a focused fader by ten decibels, so the desk is only paged while nothing
      // holds focus. This is the only input the tool ever injects.
      if (!(await readPage(connection)).bodyFocused) {
        return;
      }
      const key = goingForward ? 'PageDown' : 'PageUp';
      const code = goingForward ? 34 : 33;
      for (const type of ['keyDown', 'keyUp']) {
        await connection.send('Input.dispatchKeyEvent', {
          type,
          key,
          code: key,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
        });
      }
      const label = (await readPage(connection)).pageLabel ?? '';
      if (label !== '') {
        pagesVisited.add(label);
      }
      const [current, total] = label.split('/').map((part) => Number(part.trim()));
      if (current !== undefined && total !== undefined && Number.isFinite(current)) {
        if (goingForward && current >= total) {
          goingForward = false;
        } else if (!goingForward && current <= 1) {
          goingForward = true;
        }
      }
    };

    const takeSample = async (): Promise<void> => {
      await connection.send('HeapProfiler.collectGarbage');
      const metrics = await readMetrics(connection);
      const page = await readPage(connection);
      const sample: SoakSample = {
        atMs: Date.now() - runStartedAt,
        browser: {
          jsHeapUsedBytes: metrics.JSHeapUsedSize ?? 0,
          jsHeapTotalBytes: metrics.JSHeapTotalSize ?? 0,
          domNodes: metrics.Nodes ?? 0,
          jsEventListeners: metrics.JSEventListeners ?? 0,
          documents: metrics.Documents ?? 0,
          frames: metrics.Frames ?? 0,
          layoutCount: metrics.LayoutCount ?? 0,
          taskDurationS: metrics.TaskDuration ?? 0,
          wakeLock: page.wakeLock,
          pageLabel: page.pageLabel,
          strips: page.strips,
          videos: page.videos,
          online: page.online,
        },
        server: readServer(stack?.server),
      };
      if (pendingChurn !== undefined) {
        sample.churn = pendingChurn;
        pendingChurn = undefined;
      }
      samples.push(sample);
      await persist();
    };

    const runChurn = async (): Promise<void> => {
      const live = stack;
      if (live === undefined) {
        return;
      }
      const kind: SoakChurnKind = churnIndex % 2 === 0 ? 'ember' : 'socket';
      churnIndex += 1;
      if (kind === 'ember') {
        // The port is read before the provider goes: it is not available afterwards.
        const port = live.provider.port;
        unplugProvider(live.provider);
        await delay(SOAK_EMBER_OUTAGE_MS);
        const revived = MockEmberProvider.fromDump(loadDumpTree(dumpPath), { port });
        await revived.listen();
        live.provider = revived;
      } else {
        for (const socket of live.server.io.of('/').sockets.values()) {
          socket.conn.close(true);
        }
      }
      /*
       * The outage is waited for before the recovery is. A client takes a moment to notice its
       * transport has gone, and reading the page immediately after cutting it finds the header
       * still saying MIXER ONLINE — which would be recorded as a recovery in about a millisecond
       * and would mean nothing at all. Whether the outage was seen is recorded either way: a desk
       * back before the next poll is a good outcome, not a measurement to be believed.
       */
      const outageObserved =
        (await waitForOnlineState(connection, false, SOAK_OUTAGE_OBSERVE_MS)) !== null;
      const recoveredMs = await waitForOnline(connection, SOAK_CHURN_RECOVERY_MS);
      pendingChurn = { kind, recoveredMs, outageObserved };
      console.error(
        `soak: ${kind} churn recovered in ${recoveredMs === null ? 'never' : `${recoveredMs}ms`}` +
          `${outageObserved ? '' : ' (the outage never reached the screen)'}`,
      );
    };

    interface Job {
      nextAt: number;
      everyMs: number;
      run(): Promise<void>;
    }
    const jobs: Job[] = [
      {
        nextAt: runStartedAt + args.sampleSeconds * 1000,
        everyMs: args.sampleSeconds * 1000,
        run: takeSample,
      },
      {
        nextAt: runStartedAt + args.pageSeconds * 1000,
        everyMs: args.pageSeconds * 1000,
        run: turnPage,
      },
    ];
    if (args.churnMinutes > 0 && mode === 'default') {
      jobs.push({
        nextAt: runStartedAt + args.churnMinutes * 60_000,
        everyMs: args.churnMinutes * 60_000,
        run: runChurn,
      });
    }

    // One loop rather than three timers: each job is awaited in turn, so a slow round trip delays
    // the next tick instead of stacking calls up behind it.
    while (!controller.signal.aborted && Date.now() < deadline) {
      const now = Date.now();
      for (const job of jobs) {
        if (now >= job.nextAt) {
          job.nextAt = now + job.everyMs;
          await job.run();
        }
      }
      await delay(SOAK_TICK_MS);
    }

    // One last reading, so a run always has an end to compare against.
    if (samples.length === 0 || Date.now() - runStartedAt - (samples.at(-1)?.atMs ?? 0) > 1000) {
      await takeSample();
    }
  } catch (error) {
    runError = error;
  } finally {
    await teardown();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }

  if (samples.length === 0) {
    // Nothing was measured, so there is nothing to report: the error is the whole outcome.
    throw runError ?? new Error('the run ended before a single sample was taken');
  }

  const visitedPages = [...pagesVisited];
  const summary = summarize(samples, { mode });
  const result = verdict(summary);
  const markdown = renderMarkdown(summary, result, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    mode,
    minutes: args.minutes,
    sampleSeconds: args.sampleSeconds,
    pageSeconds: args.pageSeconds,
    churnMinutes: args.churnMinutes,
    meterHz: args.meterHz,
    browser: resolveChromeExecutable(args.browser),
    ...(args.url === undefined ? {} : { url: args.url }),
    ...(stack === undefined ? {} : { channels: stack.meterPaths.length }),
    ...(visitedPages.length === 0 ? {} : { pagesVisited: visitedPages }),
    thresholds: SOAK_DEFAULT_THRESHOLDS,
  });
  await writeFile(path.join(outDir, 'report.md'), markdown, 'utf8');

  console.error(`\nsoak: ${result.status.toUpperCase()} after ${samples.length} samples`);
  for (const failure of result.failures) {
    console.error(`  - ${failure}`);
  }
  for (const note of result.notes) {
    console.error(`  note: ${note}`);
  }
  console.error(`soak: report written to ${outDir}`);
  if (runError !== undefined) {
    console.error(
      `soak: the run was cut short: ${runError instanceof Error ? runError.message : runError}`,
    );
  }
  process.exitCode = result.status === 'fail' || runError !== undefined ? 1 : 0;

  /*
   * Everything this run owns has been closed by now, but a browser that has just been killed can
   * leave a handle behind for a moment and the report is already on disk. The timer is unref'd, so
   * a process that is free to leave still leaves immediately; this only catches one that is not.
   */
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}

/**
 * Drops the connections to a provider before stopping it listening.
 *
 * Closing it alone reaches `S101Server.discard()`, which closes the listening socket and nothing
 * else; Node leaves established connections up, so the server would keep holding a live socket to
 * a provider that is no longer answering and would never reconnect. Losing power drops the
 * connections first, and that is the failure this is meant to play.
 */
function unplugProvider(provider: MockEmberProvider): void {
  const clients = (
    provider as unknown as {
      server?: { _clients?: Iterable<{ socket?: { destroy(): void } }> };
    }
  ).server?._clients;
  for (const client of clients ?? []) {
    client.socket?.destroy();
  }
  provider.close();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
