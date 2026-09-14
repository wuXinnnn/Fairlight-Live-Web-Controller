/**
 * The synthetic programme a soak run feeds the desk.
 *
 * A soak is only worth the hour if the UI is doing the work it does on a show night, so the signal
 * has to reach every branch the meters have: the quiet body of the scale, the warning band, and a
 * peak loud enough to latch the clip indicator. It also has to stay uncorrelated between channels,
 * or twenty strips would repaint in lockstep and the render cost would be a single strip's.
 *
 * Every function here is pure, with randomness injected, so the tests can pin the shape.
 */
import type { DumpNode, DumpTree } from '@flwc/test-utils';

/** The quietest and loudest values the signal is allowed to produce. */
export const SOAK_SIGNAL_MIN_DB = -60;
export const SOAK_SIGNAL_MAX_DB = 0;

/** How long one channel's cycle lasts before its peak comes round again. */
export const SOAK_SIGNAL_PERIOD_S = 20;
/** Added per channel, so the desk never pulses as one. */
export const SOAK_SIGNAL_PERIOD_STAGGER_S = 0.7;
/** Each channel's peak starts this much later than the one before it. */
export const SOAK_SIGNAL_PEAK_STAGGER_S = 1.3;
/**
 * A plateau rather than a spike. The clip indicator latches on two consecutive frames at or above
 * zero, so at the default 20 Hz this has to be wider than 100 ms to ever latch; 600 ms is twelve
 * frames, which leaves the margin intact if the feed rate is turned down.
 */
export const SOAK_SIGNAL_PEAK_WINDOW_S = 0.6;
/** The top of the peak. Zero is the clip point, and reaching it exactly is enough to latch. */
export const SOAK_SIGNAL_PEAK_DB = 0;
/** The band the signal sweeps between peaks: quiet enough to be green, loud enough to be amber. */
export const SOAK_SIGNAL_FLOOR_DB = -40;
export const SOAK_SIGNAL_CEILING_DB = -6;
/** Peak-to-peak noise on the sweep, split either side of it. */
export const SOAK_SIGNAL_NOISE_DB = 1.5;

/** How long the loudness reading takes to drift from one end of its range to the other and back. */
export const SOAK_LOUDNESS_PERIOD_S = 120;
export const SOAK_LOUDNESS_MIN_LUFS = -26;
export const SOAK_LOUDNESS_MAX_LUFS = -20;

export interface SignalOptions {
  random?: () => number;
}

export interface LoudnessSignal {
  integratedLufs: number;
  truePeakDbtp: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Where in its own cycle a channel is at `t`, in seconds, always in `[0, period)`. */
function phaseOf(t: number, channelIndex: number): { phase: number; period: number } {
  const period = SOAK_SIGNAL_PERIOD_S + channelIndex * SOAK_SIGNAL_PERIOD_STAGGER_S;
  const offset = channelIndex * SOAK_SIGNAL_PEAK_STAGGER_S;
  const phase = (((t - offset) % period) + period) % period;
  return { phase, period };
}

/**
 * One channel's level at `t` seconds into the run, between −60 and 0 dB.
 *
 * Each cycle opens with a peak at the clip point and then sweeps the body of the scale until the
 * next one. `random` is injected so a test can make the noise disappear or sit at either extreme.
 */
export function meterSignal(t: number, channelIndex: number, options: SignalOptions = {}): number {
  const random = options.random ?? Math.random;
  const { phase, period } = phaseOf(t, channelIndex);
  if (phase < SOAK_SIGNAL_PEAK_WINDOW_S) {
    return SOAK_SIGNAL_PEAK_DB;
  }
  const sweep = (phase - SOAK_SIGNAL_PEAK_WINDOW_S) / (period - SOAK_SIGNAL_PEAK_WINDOW_S);
  const centre = (SOAK_SIGNAL_FLOOR_DB + SOAK_SIGNAL_CEILING_DB) / 2;
  const swing = (SOAK_SIGNAL_CEILING_DB - SOAK_SIGNAL_FLOOR_DB) / 2;
  const noise = (random() - 0.5) * SOAK_SIGNAL_NOISE_DB;
  const body = centre + swing * Math.sin(2 * Math.PI * sweep) + noise;
  return clamp(body, SOAK_SIGNAL_FLOOR_DB, SOAK_SIGNAL_CEILING_DB);
}

/** Whether a channel is inside its peak at `t`. Exposed for the tests that count peaks. */
export function isPeaking(t: number, channelIndex: number): boolean {
  return phaseOf(t, channelIndex).phase < SOAK_SIGNAL_PEAK_WINDOW_S;
}

/**
 * The loudness pair at `t`. Integrated drifts slowly across its range; true peak follows the
 * loudest channel on the desk, the way a real meter would.
 */
export function loudnessSignal(
  t: number,
  channelCount: number,
  options: SignalOptions = {},
): LoudnessSignal {
  const centre = (SOAK_LOUDNESS_MIN_LUFS + SOAK_LOUDNESS_MAX_LUFS) / 2;
  const swing = (SOAK_LOUDNESS_MAX_LUFS - SOAK_LOUDNESS_MIN_LUFS) / 2;
  const integratedLufs = centre + swing * Math.sin((2 * Math.PI * t) / SOAK_LOUDNESS_PERIOD_S);
  let truePeakDbtp = SOAK_SIGNAL_MIN_DB;
  for (let index = 0; index < channelCount; index += 1) {
    truePeakDbtp = Math.max(truePeakDbtp, meterSignal(t, index, options));
  }
  return { integratedLufs, truePeakDbtp };
}

/** The roots this project maps to strips. Everything else in the tree has no meter to feed. */
const MAPPED_ROOTS = new Set(['channel', 'main', 'aux']);

function collectMeters(node: DumpNode, into: string[]): void {
  const path = node.identifierPath;
  if (path !== undefined && path.endsWith('/meter')) {
    into.push(path);
  }
  for (const child of node.children ?? []) {
    collectMeters(child, into);
  }
}

/**
 * Every meter path in a dump that belongs to a strip this project shows, in tree order. The desk
 * carries meters under roots the app does not map — monitor, talkback and the rest — and feeding
 * those would cost the run time without putting anything on screen.
 */
export function collectMeterPaths(dump: DumpTree): string[] {
  const paths: string[] = [];
  for (const node of dump.nodes) {
    if (node.identifier !== undefined && MAPPED_ROOTS.has(node.identifier)) {
      collectMeters(node, paths);
    }
  }
  return paths;
}
