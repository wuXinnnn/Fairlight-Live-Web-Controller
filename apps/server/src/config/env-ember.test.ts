import { describe, expect, it } from 'vitest';
import type { AppLogger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { EMBER_PROBE_INTERVAL_ENV, EMBER_STRIP_TIMEOUT_ENV, readEmberTuning } from './env-ember.js';

function countingLogger(): AppLogger & { warnings: object[] } {
  const warnings: object[] = [];
  return {
    ...silentLogger(),
    warn: (obj) => warnings.push(obj),
    warnings,
  };
}

describe('readEmberTuning', () => {
  it('overrides nothing when neither variable is set', () => {
    expect(readEmberTuning({}, silentLogger())).toEqual({});
  });

  it('takes both values', () => {
    expect(
      readEmberTuning(
        { [EMBER_PROBE_INTERVAL_ENV]: '120000', [EMBER_STRIP_TIMEOUT_ENV]: '5000' },
        silentLogger(),
      ),
    ).toEqual({ busDirectoryPollMs: 120_000, stripDirectoryTimeoutMs: 5_000 });
  });

  it('lets zero turn the probe off but not the strip timeout', () => {
    const logger = countingLogger();
    expect(
      readEmberTuning({ [EMBER_PROBE_INTERVAL_ENV]: '0', [EMBER_STRIP_TIMEOUT_ENV]: '0' }, logger),
    ).toEqual({ busDirectoryPollMs: 0 });
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toMatchObject({ variable: EMBER_STRIP_TIMEOUT_ENV, value: '0' });
  });

  it.each(['-1', '-60000'])('warns and ignores a negative value such as %j', (value) => {
    const logger = countingLogger();
    expect(
      readEmberTuning(
        { [EMBER_PROBE_INTERVAL_ENV]: value, [EMBER_STRIP_TIMEOUT_ENV]: value },
        logger,
      ),
    ).toEqual({});
    expect(logger.warnings).toHaveLength(2);
  });

  it.each(['abc', '', ' ', '60s'])('warns and ignores a non-number such as %j', (value) => {
    const logger = countingLogger();
    expect(readEmberTuning({ [EMBER_PROBE_INTERVAL_ENV]: value }, logger)).toEqual({});
    // The raw value goes into the warning: a container operator only has the log to go on.
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toMatchObject({ variable: EMBER_PROBE_INTERVAL_ENV, value });
  });

  it.each(['1.5', '2000.0001'])('warns and ignores a fraction such as %j', (value) => {
    const logger = countingLogger();
    expect(readEmberTuning({ [EMBER_STRIP_TIMEOUT_ENV]: value }, logger)).toEqual({});
    expect(logger.warnings).toHaveLength(1);
  });

  it('keeps the good value when only the other one is bad', () => {
    const logger = countingLogger();
    expect(
      readEmberTuning(
        { [EMBER_PROBE_INTERVAL_ENV]: 'soon', [EMBER_STRIP_TIMEOUT_ENV]: '3000' },
        logger,
      ),
    ).toEqual({ stripDirectoryTimeoutMs: 3_000 });
    expect(logger.warnings).toHaveLength(1);
  });

  it('does not throw on a bad value, so a typo cannot stop the server coming up', () => {
    expect(() =>
      readEmberTuning({ [EMBER_PROBE_INTERVAL_ENV]: 'nope' }, silentLogger()),
    ).not.toThrow();
  });
});
