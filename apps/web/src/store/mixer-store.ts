import {
  defaultLoudnessState,
  type ChannelState,
  type ConnectionStatus,
  type ControlAck,
  type MixerPatch,
  type MixerSnapshot,
} from '@flwc/shared';
import { createStore } from 'zustand/vanilla';

interface PendingLevel {
  baseline: number;
  remoteValue?: number;
}

interface PendingOn {
  baselineMuted: boolean;
  remoteMuted?: boolean;
}

export interface MixerStoreState {
  channels: Record<string, ChannelState>;
  channelOrder: string[];
  loudness: ReturnType<typeof defaultLoudnessState>;
  socketConnected: boolean;
  emberStatus: ConnectionStatus;
  pendingLevels: Record<string, PendingLevel>;
  pendingOns: Record<string, PendingOn>;
  notice: string | null;
}

const INITIAL_STATE: MixerStoreState = {
  channels: {},
  channelOrder: [],
  loudness: defaultLoudnessState(),
  socketConnected: false,
  emberStatus: 'disconnected',
  pendingLevels: {},
  pendingOns: {},
  notice: null,
};

export const mixerStore = createStore<MixerStoreState>()(() => INITIAL_STATE);

export function resetMixerStore(): void {
  mixerStore.setState(INITIAL_STATE, true);
}

export function setSocketConnected(connected: boolean): void {
  mixerStore.setState({ socketConnected: connected });
}

export function setEmberStatus(status: ConnectionStatus): void {
  mixerStore.setState({ emberStatus: status });
}

export function replaceMixerSnapshot(snapshot: MixerSnapshot): void {
  const channels = Object.fromEntries(snapshot.channels.map((channel) => [channel.id, channel]));
  mixerStore.setState({
    channels,
    channelOrder: snapshot.channels.map((channel) => channel.id),
    loudness: snapshot.loudness,
    emberStatus: snapshot.connection,
    pendingLevels: {},
    pendingOns: {},
  });
}

export function applyMixerPatch(patch: MixerPatch): void {
  mixerStore.setState((state) => {
    const channels = { ...state.channels };
    const channelOrder = [...state.channelOrder];
    const pendingLevels = { ...state.pendingLevels };
    const pendingOns = { ...state.pendingOns };

    for (const channel of patch.upserts ?? []) {
      const current = channels[channel.id];
      const pendingLevel = pendingLevels[channel.id];
      const pendingOn = pendingOns[channel.id];
      channels[channel.id] = {
        ...current,
        ...channel,
        levelDb:
          pendingLevel === undefined ? channel.levelDb : (current?.levelDb ?? channel.levelDb),
        muted: pendingOn === undefined ? channel.muted : (current?.muted ?? channel.muted),
      };
      if (pendingLevel !== undefined) {
        pendingLevels[channel.id] = {
          ...pendingLevel,
          remoteValue: channel.levelDb,
        };
      }
      if (pendingOn !== undefined) {
        pendingOns[channel.id] = {
          ...pendingOn,
          remoteMuted: channel.muted,
        };
      }
      if (!channelOrder.includes(channel.id)) {
        channelOrder.push(channel.id);
      }
    }

    for (const id of patch.removedIds ?? []) {
      delete channels[id];
      delete pendingLevels[id];
      delete pendingOns[id];
      const index = channelOrder.indexOf(id);
      if (index >= 0) {
        channelOrder.splice(index, 1);
      }
    }

    return {
      channels,
      channelOrder,
      pendingLevels,
      pendingOns,
      loudness: patch.loudness ?? state.loudness,
    };
  });
}

export function beginLevelInteraction(id: string): void {
  mixerStore.setState((state) => {
    const channel = state.channels[id];
    if (channel === undefined || state.pendingLevels[id] !== undefined) {
      return state;
    }
    return {
      pendingLevels: {
        ...state.pendingLevels,
        [id]: { baseline: channel.levelDb },
      },
    };
  });
}

export function setLocalLevel(id: string, levelDb: number): void {
  mixerStore.setState((state) => {
    const channel = state.channels[id];
    if (channel === undefined) {
      return state;
    }
    return {
      channels: {
        ...state.channels,
        [id]: { ...channel, levelDb },
      },
    };
  });
}

export function finishLevelInteraction(id: string, ack: ControlAck): void {
  mixerStore.setState((state) => {
    const pending = state.pendingLevels[id];
    const channel = state.channels[id];
    if (pending === undefined || channel === undefined) {
      return state;
    }
    const pendingLevels = { ...state.pendingLevels };
    delete pendingLevels[id];
    const levelDb = pending.remoteValue ?? (ack.ok ? channel.levelDb : pending.baseline);
    return {
      channels: {
        ...state.channels,
        [id]: { ...channel, levelDb },
      },
      pendingLevels,
      notice: ack.ok ? state.notice : ack.error.message,
    };
  });
}

export function beginOnInteraction(id: string, on: boolean): void {
  mixerStore.setState((state) => {
    const channel = state.channels[id];
    if (channel === undefined || state.pendingOns[id] !== undefined) {
      return state;
    }
    return {
      channels: {
        ...state.channels,
        [id]: { ...channel, muted: !on },
      },
      pendingOns: {
        ...state.pendingOns,
        [id]: { baselineMuted: channel.muted },
      },
    };
  });
}

export function finishOnInteraction(id: string, ack: ControlAck): void {
  mixerStore.setState((state) => {
    const pending = state.pendingOns[id];
    const channel = state.channels[id];
    if (pending === undefined || channel === undefined) {
      return state;
    }
    const pendingOns = { ...state.pendingOns };
    delete pendingOns[id];
    const muted = pending.remoteMuted ?? (ack.ok ? channel.muted : pending.baselineMuted);
    return {
      channels: {
        ...state.channels,
        [id]: { ...channel, muted },
      },
      pendingOns,
      notice: ack.ok ? state.notice : ack.error.message,
    };
  });
}

export function setNotice(message: string | null): void {
  mixerStore.setState({ notice: message });
}

export function controlsAvailable(state: MixerStoreState): boolean {
  return state.socketConnected && state.emberStatus === 'connected';
}
