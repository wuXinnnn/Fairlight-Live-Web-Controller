import type { AppLogger } from '../logger.js';

/** Overrides the mixer strip probe period in ms; `0` turns the probe off. */
export const EMBER_PROBE_INTERVAL_ENV = 'FLWC_EMBER_PROBE_INTERVAL_MS';
/** Overrides the GetDirectory timeout for named strips in ms. */
export const EMBER_STRIP_TIMEOUT_ENV = 'FLWC_EMBER_STRIP_TIMEOUT_MS';

/**
 * The Ember timings the environment may override. A field is present only when its variable is
 * set to something acceptable; the caller's defaults stand for the rest.
 */
export interface EmberTuning {
  busDirectoryPollMs?: number;
  stripDirectoryTimeoutMs?: number;
}

/**
 * Reads the Ember timing overrides from the environment. Like `readEmberSeed`, a bad value is a
 * warning and is then ignored, never a throw: one mistyped variable must not stop the server
 * coming up. The probe interval accepts any non-negative integer (zero means off); the strip
 * timeout has to be a positive integer.
 */
export function readEmberTuning(env: NodeJS.ProcessEnv, logger: AppLogger): EmberTuning {
  const tuning: EmberTuning = {};
  const probeIntervalMs = readInteger(env, EMBER_PROBE_INTERVAL_ENV, 0, logger);
  if (probeIntervalMs !== undefined) {
    tuning.busDirectoryPollMs = probeIntervalMs;
  }
  const stripTimeoutMs = readInteger(env, EMBER_STRIP_TIMEOUT_ENV, 1, logger);
  if (stripTimeoutMs !== undefined) {
    tuning.stripDirectoryTimeoutMs = stripTimeoutMs;
  }
  return tuning;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  logger: AppLogger,
): number | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < minimum) {
    logger.warn(
      { variable: name, value: raw, layer: 'validation' },
      `ignoring ${name}: expected an integer of at least ${minimum} milliseconds`,
    );
    return undefined;
  }
  return value;
}
