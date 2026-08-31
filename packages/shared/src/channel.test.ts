import { describe, expect, it } from 'vitest';
import {
  CHANNEL_KINDS,
  channelKindSchema,
  channelStateSchema,
  connectionStatusSchema,
  defaultLoudnessState,
  DEFAULT_INTEGRATED_LUFS,
  DEFAULT_METER_DB,
  DEFAULT_TRUE_PEAK_DBTP,
  loudnessStateSchema,
} from './channel.js';

describe('channel schemas', () => {
  it('accepts every supported channel kind', () => {
    expect(CHANNEL_KINDS).toEqual(['channel', 'main', 'sub', 'aux', 'mixm', 'mtx']);
    for (const kind of CHANNEL_KINDS) {
      expect(channelKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects an unknown channel kind', () => {
    expect(() => channelKindSchema.parse('bus')).toThrow();
  });

  it('parses a full channel state', () => {
    const state = {
      id: 'channel/3',
      kind: 'channel',
      name: 'BASS',
      levelDb: -6,
      muted: false,
      meterDb: -20,
    };
    expect(channelStateSchema.parse(state)).toEqual(state);
  });

  it('rejects a channel state missing id', () => {
    expect(() =>
      channelStateSchema.parse({
        kind: 'channel',
        name: 'BASS',
        levelDb: -6,
        muted: false,
        meterDb: -20,
      }),
    ).toThrow();
  });

  it('parses connection statuses', () => {
    for (const status of ['disconnected', 'connecting', 'connected', 'reconnecting'] as const) {
      expect(connectionStatusSchema.parse(status)).toBe(status);
    }
    expect(() => connectionStatusSchema.parse('online')).toThrow();
  });

  it('returns default loudness constants', () => {
    expect(defaultLoudnessState()).toEqual({
      integratedLufs: DEFAULT_INTEGRATED_LUFS,
      truePeakDbtp: DEFAULT_TRUE_PEAK_DBTP,
    });
    expect(loudnessStateSchema.parse(defaultLoudnessState())).toEqual(defaultLoudnessState());
    expect(DEFAULT_METER_DB).toBe(-60);
  });
});
