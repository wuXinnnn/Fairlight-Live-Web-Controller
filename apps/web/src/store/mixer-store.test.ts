import type { ChannelState, MixerSnapshot } from '@flwc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMixerPatch,
  beginLevelInteraction,
  beginOnInteraction,
  controlsAvailable,
  finishLevelInteraction,
  finishOnInteraction,
  mixerStore,
  replaceMixerSnapshot,
  resetMixerStore,
  setLocalLevel,
  setSocketConnected,
} from './mixer-store.js';

const channel: ChannelState = {
  id: 'channel/1',
  kind: 'channel',
  name: 'BASS',
  levelDb: -12,
  muted: false,
  meterDb: -30,
};

const snapshot: MixerSnapshot = {
  channels: [channel],
  loudness: { integratedLufs: -23, truePeakDbtp: -4 },
  connection: 'connected',
};

describe('mixer store', () => {
  beforeEach(() => {
    resetMixerStore();
  });

  it('replaces snapshots and exposes the combined control availability', () => {
    replaceMixerSnapshot(snapshot);
    setSocketConnected(true);
    expect(mixerStore.getState().channelOrder).toEqual(['channel/1']);
    expect(controlsAvailable(mixerStore.getState())).toBe(true);

    replaceMixerSnapshot({ ...snapshot, channels: [], connection: 'reconnecting' });
    expect(mixerStore.getState().channels).toEqual({});
    expect(controlsAvailable(mixerStore.getState())).toBe(false);
  });

  it('merges renamed and added channels and removes missing ids', () => {
    replaceMixerSnapshot(snapshot);
    applyMixerPatch({
      upserts: [
        { ...channel, name: 'BASS DI' },
        { ...channel, id: 'main/1', kind: 'main', name: 'MAIN' },
      ],
      loudness: { integratedLufs: -21, truePeakDbtp: -3 },
    });
    expect(mixerStore.getState().channels['channel/1']?.name).toBe('BASS DI');
    expect(mixerStore.getState().channelOrder).toEqual(['channel/1', 'main/1']);

    applyMixerPatch({ removedIds: ['channel/1'] });
    expect(mixerStore.getState().channels['channel/1']).toBeUndefined();
    expect(mixerStore.getState().loudness.integratedLufs).toBe(-21);
  });

  it('keeps a local level during remote patches and converges after ack', () => {
    replaceMixerSnapshot(snapshot);
    beginLevelInteraction(channel.id);
    setLocalLevel(channel.id, -5);
    applyMixerPatch({ upserts: [{ ...channel, levelDb: -6, name: 'BASS NEW' }] });
    expect(mixerStore.getState().channels[channel.id]).toMatchObject({
      levelDb: -5,
      name: 'BASS NEW',
    });

    finishLevelInteraction(channel.id, { ok: true });
    expect(mixerStore.getState().channels[channel.id]?.levelDb).toBe(-6);
    expect(mixerStore.getState().pendingLevels).toEqual({});
  });

  it('rolls a rejected level back to its baseline', () => {
    replaceMixerSnapshot(snapshot);
    beginLevelInteraction(channel.id);
    setLocalLevel(channel.id, -2);
    finishLevelInteraction(channel.id, {
      ok: false,
      error: { code: 'PROTOCOL', message: 'Mixer unavailable' },
    });
    expect(mixerStore.getState().channels[channel.id]?.levelDb).toBe(-12);
    expect(mixerStore.getState().notice).toBe('Mixer unavailable');
  });

  it('optimistically inverts ON to muted and rolls back rejected commands', () => {
    replaceMixerSnapshot(snapshot);
    beginOnInteraction(channel.id, false);
    expect(mixerStore.getState().channels[channel.id]?.muted).toBe(true);
    finishOnInteraction(channel.id, {
      ok: false,
      error: { code: 'PROTOCOL', message: 'Write failed' },
    });
    expect(mixerStore.getState().channels[channel.id]?.muted).toBe(false);

    beginOnInteraction(channel.id, false);
    applyMixerPatch({ upserts: [{ ...channel, muted: true }] });
    finishOnInteraction(channel.id, { ok: true });
    expect(mixerStore.getState().channels[channel.id]?.muted).toBe(true);
  });

  it('ignores interactions for unknown or already pending channels', () => {
    beginLevelInteraction('missing');
    beginOnInteraction('missing', true);
    setLocalLevel('missing', -1);
    finishLevelInteraction('missing', { ok: true });
    finishOnInteraction('missing', { ok: true });
    expect(mixerStore.getState().pendingLevels).toEqual({});

    replaceMixerSnapshot(snapshot);
    beginLevelInteraction(channel.id);
    beginLevelInteraction(channel.id);
    beginOnInteraction(channel.id, false);
    beginOnInteraction(channel.id, true);
    expect(mixerStore.getState().pendingLevels[channel.id]?.baseline).toBe(-12);
    expect(mixerStore.getState().channels[channel.id]?.muted).toBe(true);
  });
});
