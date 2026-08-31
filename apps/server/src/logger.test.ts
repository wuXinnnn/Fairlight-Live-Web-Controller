import { describe, expect, it } from 'vitest';
import { errorMessage, silentLogger } from './logger.js';

describe('logger helpers', () => {
  it('stringifies unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('nope')).toBe('nope');
  });

  it('exposes a silent logger that swallows calls', () => {
    const logger = silentLogger();
    expect(() => logger.debug({}, 'd')).not.toThrow();
    expect(() => logger.info({}, 'i')).not.toThrow();
    expect(() => logger.warn({}, 'w')).not.toThrow();
    expect(() => logger.error({}, 'e')).not.toThrow();
  });
});
