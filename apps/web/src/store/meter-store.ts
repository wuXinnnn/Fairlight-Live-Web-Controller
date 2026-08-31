import {
  DEFAULT_METER_DB,
  defaultLoudnessState,
  type MetersFrame,
  type MixerSnapshot,
} from '@flwc/shared';
import { createStore } from 'zustand/vanilla';

export interface MeterStoreState {
  meters: Record<string, number>;
  loudness: ReturnType<typeof defaultLoudnessState>;
}

const INITIAL_STATE: MeterStoreState = {
  meters: {},
  loudness: defaultLoudnessState(),
};

export const meterStore = createStore<MeterStoreState>()(() => INITIAL_STATE);

export function resetMeterStore(): void {
  meterStore.setState(INITIAL_STATE, true);
}

export function seedMetersFromSnapshot(snapshot: MixerSnapshot): void {
  meterStore.setState({
    meters: Object.fromEntries(snapshot.channels.map((channel) => [channel.id, channel.meterDb])),
    loudness: snapshot.loudness,
  });
}

export function applyMetersFrame(frame: MetersFrame): void {
  meterStore.setState((state) => ({
    meters: {
      ...state.meters,
      ...Object.fromEntries(frame.meters),
    },
    loudness: frame.loudness ?? state.loudness,
  }));
}

export function getMeterValue(id: string): number {
  return meterStore.getState().meters[id] ?? DEFAULT_METER_DB;
}
