import { describe, expect, it } from 'vitest';
import {
  metersFrameSchema,
  mixerPatchSchema,
  mixerSnapshotSchema,
  systemStatusSchema,
} from './mixer.js';

const channel = {
  id: 'channel/1',
  kind: 'channel' as const,
  name: 'BASS',
  levelDb: -6,
  muted: false,
  meterDb: -20,
};

describe('mixer message schemas', () => {
  it('parses a snapshot', () => {
    const snapshot = {
      channels: [channel],
      loudness: { integratedLufs: -23, truePeakDbtp: -6 },
      connection: 'connected' as const,
    };
    expect(mixerSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('parses a sparse patch', () => {
    expect(mixerPatchSchema.parse({})).toEqual({});
    expect(mixerPatchSchema.parse({ removedIds: ['channel/9'], upserts: [channel] })).toEqual({
      removedIds: ['channel/9'],
      upserts: [channel],
    });
  });

  it('parses a meters frame and system status', () => {
    expect(
      metersFrameSchema.parse({
        meters: [['channel/1', -12.5]],
        loudness: { integratedLufs: -26, truePeakDbtp: -3 },
      }),
    ).toMatchObject({ meters: [['channel/1', -12.5]] });
    expect(systemStatusSchema.parse({ ember: 'reconnecting' })).toEqual({ ember: 'reconnecting' });
  });

  it('rejects an invalid meter entry', () => {
    expect(() => metersFrameSchema.parse({ meters: [[123, -1]] })).toThrow();
    expect(() =>
      mixerSnapshotSchema.parse({ channels: [], loudness: {}, connection: 'connected' }),
    ).toThrow();
  });
});
