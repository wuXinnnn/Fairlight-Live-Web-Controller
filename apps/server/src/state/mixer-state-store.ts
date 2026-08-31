import { EventEmitter } from 'node:events';
import {
  defaultLoudnessState,
  type ChannelState,
  type ConnectionStatus,
  type LoudnessState,
  type MixerPatch,
  type MixerSnapshot,
} from '@flwc/shared';
import type { TreeSyncResult } from '../ember/tree-mapper.js';

export class MixerStateStore extends EventEmitter {
  private readonly channels = new Map<string, ChannelState>();
  private loudnessState: LoudnessState = defaultLoudnessState();
  private connectionStatus: ConnectionStatus = 'disconnected';

  get connection(): ConnectionStatus {
    return this.connectionStatus;
  }

  get loudness(): LoudnessState {
    return this.loudnessState;
  }

  snapshot(): MixerSnapshot {
    return {
      channels: [...this.channels.values()],
      loudness: this.loudnessState,
      connection: this.connectionStatus,
    };
  }

  getChannel(id: string): ChannelState | undefined {
    return this.channels.get(id);
  }

  applySync(result: TreeSyncResult): void {
    for (const id of result.removedIds) {
      this.channels.delete(id);
    }
    for (const state of [...result.added, ...result.updated]) {
      this.channels.set(state.id, { ...state });
    }
    if (result.loudness !== undefined) {
      this.loudnessState = result.loudness;
    }
    if (result.structureChanged) {
      this.emit('snapshot', this.snapshot());
      return;
    }
    if (result.updated.length > 0 || result.loudness !== undefined) {
      const patch: MixerPatch = {};
      if (result.updated.length > 0) {
        patch.upserts = result.updated;
      }
      if (result.loudness !== undefined) {
        patch.loudness = result.loudness;
      }
      this.emit('patch', patch);
    }
  }

  setConnection(status: ConnectionStatus): void {
    if (this.connectionStatus === status) {
      return;
    }
    this.connectionStatus = status;
    this.emit('status', status);
  }

  setLevel(id: string, levelDb: number): void {
    this.patchChannel(id, { levelDb });
  }

  setMuted(id: string, muted: boolean): void {
    this.patchChannel(id, { muted });
  }

  setName(id: string, name: string): void {
    this.patchChannel(id, { name });
  }

  setMeterSilent(id: string, meterDb: number): void {
    const current = this.channels.get(id);
    if (current === undefined || current.meterDb === meterDb) {
      return;
    }
    this.channels.set(id, { ...current, meterDb });
  }

  setLoudnessSilent(partial: Partial<LoudnessState>): void {
    this.loudnessState = { ...this.loudnessState, ...partial };
  }

  private patchChannel(id: string, fields: Partial<ChannelState>): void {
    const current = this.channels.get(id);
    if (current === undefined) {
      return;
    }
    const next = { ...current, ...fields };
    if (sameChannel(current, next)) {
      return;
    }
    this.channels.set(id, next);
    this.emit('patch', { upserts: [next] } satisfies MixerPatch);
  }
}

function sameChannel(left: ChannelState, right: ChannelState): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.levelDb === right.levelDb &&
    left.muted === right.muted &&
    left.meterDb === right.meterDb
  );
}
