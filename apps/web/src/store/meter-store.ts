import {
  DEFAULT_METER_DB,
  defaultLoudnessState,
  type MetersFrame,
  type MixerSnapshot,
} from '@flwc/shared';
import { createStore } from 'zustand/vanilla';

export interface MeterStoreState {
  meters: Record<string, number>;
  zeroDbStreaks: Record<string, number>;
  clipping: Record<string, boolean>;
  loudness: ReturnType<typeof defaultLoudnessState>;
}

const INITIAL_STATE: MeterStoreState = {
  meters: {},
  zeroDbStreaks: {},
  clipping: {},
  loudness: defaultLoudnessState(),
};

export const meterStore = createStore<MeterStoreState>()(() => INITIAL_STATE);

export function resetMeterStore(): void {
  meterStore.setState(INITIAL_STATE, true);
}

export function seedMetersFromSnapshot(snapshot: MixerSnapshot): void {
  meterStore.setState({
    meters: Object.fromEntries(snapshot.channels.map((channel) => [channel.id, channel.meterDb])),
    zeroDbStreaks: Object.fromEntries(
      snapshot.channels.map((channel) => [channel.id, channel.meterDb >= 0 ? 1 : 0]),
    ),
    clipping: Object.fromEntries(snapshot.channels.map((channel) => [channel.id, false])),
    loudness: snapshot.loudness,
  });
}

export function applyMetersFrame(frame: MetersFrame): void {
  meterStore.setState((state) => {
    const zeroDbStreaks = { ...state.zeroDbStreaks };
    const clipping = { ...state.clipping };
    for (const [id, meterDb] of frame.meters) {
      const streak = meterDb >= 0 ? (zeroDbStreaks[id] ?? 0) + 1 : 0;
      zeroDbStreaks[id] = streak;
      clipping[id] = streak >= 2;
    }
    return {
      meters: {
        ...state.meters,
        ...Object.fromEntries(frame.meters),
      },
      zeroDbStreaks,
      clipping,
      loudness: frame.loudness ?? state.loudness,
    };
  });
}

export function getMeterValue(id: string): number {
  return meterStore.getState().meters[id] ?? DEFAULT_METER_DB;
}
