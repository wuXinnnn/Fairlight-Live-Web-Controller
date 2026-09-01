import type { MixerSnapshot } from '@flwc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMetersFrame,
  getMeterValue,
  meterStore,
  resetMeterStore,
  seedMetersFromSnapshot,
} from './meter-store.js';

const snapshot: MixerSnapshot = {
  channels: [
    {
      id: 'channel/1',
      kind: 'channel',
      name: 'BASS',
      levelDb: -12,
      muted: false,
      meterDb: -28,
    },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connected',
};

describe('meter store', () => {
  beforeEach(resetMeterStore);

  it('seeds all readings from a snapshot', () => {
    seedMetersFromSnapshot(snapshot);
    expect(getMeterValue('channel/1')).toBe(-28);
    expect(meterStore.getState().loudness.integratedLufs).toBe(-23);
  });

  it('merges delta frames without dropping older channels', () => {
    seedMetersFromSnapshot(snapshot);
    applyMetersFrame({ meters: [['main/1', -8]] });
    applyMetersFrame({
      meters: [['channel/1', -10]],
      loudness: { integratedLufs: -20, truePeakDbtp: -2 },
    });
    expect(meterStore.getState().meters).toEqual({
      'channel/1': -10,
      'main/1': -8,
    });
    expect(meterStore.getState().loudness.truePeakDbtp).toBe(-2);
    expect(getMeterValue('missing')).toBe(-60);
  });

  it('raises clipping only after two consecutive 0 dB frames', () => {
    applyMetersFrame({ meters: [['channel/1', 0]] });
    expect(meterStore.getState().clipping['channel/1']).toBe(false);
    applyMetersFrame({ meters: [['channel/1', 0]] });
    expect(meterStore.getState().clipping['channel/1']).toBe(true);

    applyMetersFrame({ meters: [['channel/1', -0.1]] });
    expect(meterStore.getState().clipping['channel/1']).toBe(false);
    expect(meterStore.getState().zeroDbStreaks['channel/1']).toBe(0);
  });
});
