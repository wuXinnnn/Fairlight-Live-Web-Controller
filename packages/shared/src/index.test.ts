import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBER_PORT,
  ERROR_CODES,
  SOCKET_EVENTS,
  defaultAppConfig,
  defaultLoudnessState,
  healthResponseSchema,
} from './index.js';

describe('shared barrel', () => {
  it('re-exports the contracts used by server and web', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(defaultAppConfig().ember.port).toBe(DEFAULT_EMBER_PORT);
    expect(defaultLoudnessState().truePeakDbtp).toBe(-60);
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(SOCKET_EVENTS.MIXER_SNAPSHOT).toBe('mixer:snapshot');
  });
});
