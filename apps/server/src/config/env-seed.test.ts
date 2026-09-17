import { DEFAULT_EMBER_HOST, DEFAULT_EMBER_PORT } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import type { AppLogger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { EMBER_HOST_ENV, EMBER_PORT_ENV, readEmberSeed } from './env-seed.js';

function countingLogger(): AppLogger & { warnings: object[] } {
  const warnings: object[] = [];
  return {
    ...silentLogger(),
    warn: (obj) => warnings.push(obj),
    warnings,
  };
}

describe('readEmberSeed', () => {
  it('asks for nothing when neither variable is set', () => {
    expect(readEmberSeed({}, silentLogger())).toBeUndefined();
  });

  it('takes both values', () => {
    expect(
      readEmberSeed({ [EMBER_HOST_ENV]: '10.0.0.8', [EMBER_PORT_ENV]: '9001' }, silentLogger()),
    ).toEqual({ host: '10.0.0.8', port: 9001 });
  });

  it('fills in the default port when only the host is set', () => {
    expect(readEmberSeed({ [EMBER_HOST_ENV]: '10.0.0.8' }, silentLogger())).toEqual({
      host: '10.0.0.8',
      port: DEFAULT_EMBER_PORT,
    });
  });

  it('fills in the default host when only the port is set', () => {
    expect(readEmberSeed({ [EMBER_PORT_ENV]: '9001' }, silentLogger())).toEqual({
      host: DEFAULT_EMBER_HOST,
      port: 9001,
    });
  });

  it.each(['not-a-number', '0', '65536', '9000.5', ''])(
    'warns and asks for nothing when the port is %j',
    (port) => {
      const logger = countingLogger();
      expect(readEmberSeed({ [EMBER_PORT_ENV]: port }, logger)).toBeUndefined();
      // The raw value goes into the warning: a container operator only has the log to go on.
      expect(logger.warnings).toHaveLength(1);
      expect(logger.warnings[0]).toMatchObject({ port });
    },
  );

  it('warns and asks for nothing when the host is blank', () => {
    const logger = countingLogger();
    expect(readEmberSeed({ [EMBER_HOST_ENV]: '' }, logger)).toBeUndefined();
    expect(logger.warnings).toHaveLength(1);
  });

  it('does not throw on a bad value, so a typo cannot stop the server coming up', () => {
    expect(() =>
      readEmberSeed({ [EMBER_HOST_ENV]: '', [EMBER_PORT_ENV]: 'nope' }, silentLogger()),
    ).not.toThrow();
  });
});
