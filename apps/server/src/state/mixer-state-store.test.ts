import { describe, expect, it, vi } from 'vitest';
import type { ChannelState } from '@flwc/shared';
import { MixerStateStore } from './mixer-state-store.js';

const bass: ChannelState = {
  id: 'channel/1',
  kind: 'channel',
  name: 'BASS',
  levelDb: -6,
  muted: false,
  meterDb: -20,
};

describe('MixerStateStore', () => {
  it('applies a structural sync as a snapshot', () => {
    const store = new MixerStateStore();
    const snapshots: unknown[] = [];
    store.on('snapshot', (snapshot) => snapshots.push(snapshot));
    store.applySync({
      added: [bass],
      updated: [],
      removedIds: [],
      loudness: { integratedLufs: -23, truePeakDbtp: -6 },
      structureChanged: true,
    });
    expect(store.snapshot().channels).toEqual([bass]);
    expect(snapshots).toHaveLength(1);
  });

  it('emits a patch for in-place updates and removals that are not structural wait', () => {
    const store = new MixerStateStore();
    store.applySync({
      added: [bass],
      updated: [],
      removedIds: [],
      loudness: undefined,
      structureChanged: true,
    });
    const patches: unknown[] = [];
    store.on('patch', (patch) => patches.push(patch));
    store.applySync({
      added: [],
      updated: [{ ...bass, levelDb: -3 }],
      removedIds: [],
      loudness: { integratedLufs: -20, truePeakDbtp: -1 },
      structureChanged: false,
    });
    expect(patches[0]).toMatchObject({
      upserts: [{ id: 'channel/1', levelDb: -3 }],
      loudness: { integratedLufs: -20, truePeakDbtp: -1 },
    });
  });

  it('emits patches for control-driven changes and ignores unknown ids', () => {
    const store = new MixerStateStore();
    store.applySync({
      added: [bass],
      updated: [],
      removedIds: [],
      loudness: undefined,
      structureChanged: true,
    });
    const patches: unknown[] = [];
    store.on('patch', (patch) => patches.push(patch));
    store.setLevel('channel/1', -9);
    store.setMuted('channel/1', true);
    store.setName('channel/1', 'BASS-2');
    store.setLevel('missing', 0);
    store.setLevel('channel/1', -9);
    expect(patches).toHaveLength(3);
    expect(store.getChannel('channel/1')).toMatchObject({
      levelDb: -9,
      muted: true,
      name: 'BASS-2',
    });
  });

  it('updates meter and loudness silently and deduplicates status', () => {
    const store = new MixerStateStore();
    store.applySync({
      added: [bass],
      updated: [],
      removedIds: [],
      loudness: undefined,
      structureChanged: true,
    });
    const patch = vi.fn();
    store.on('patch', patch);
    store.setMeterSilent('channel/1', -12);
    store.setMeterSilent('channel/1', -12);
    store.setMeterSilent('missing', -1);
    store.setLoudnessSilent({ integratedLufs: -18 });
    expect(patch).not.toHaveBeenCalled();
    expect(store.getChannel('channel/1')?.meterDb).toBe(-12);
    expect(store.loudness.integratedLufs).toBe(-18);

    const statuses: string[] = [];
    store.on('status', (status) => statuses.push(status));
    store.setConnection('connecting');
    store.setConnection('connecting');
    store.setConnection('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('removes channels on a structural sync', () => {
    const store = new MixerStateStore();
    store.applySync({
      added: [bass, { ...bass, id: 'channel/2', name: 'PC' }],
      updated: [],
      removedIds: [],
      loudness: undefined,
      structureChanged: true,
    });
    store.applySync({
      added: [],
      updated: [],
      removedIds: ['channel/2'],
      loudness: undefined,
      structureChanged: true,
    });
    expect(store.snapshot().channels.map((channel) => channel.id)).toEqual(['channel/1']);
  });
});
