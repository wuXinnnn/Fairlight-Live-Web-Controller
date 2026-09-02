import {
  SOCKET_EVENTS,
  controlAckSchema,
  metersFrameSchema,
  mixerPatchSchema,
  mixerSnapshotSchema,
  systemStatusSchema,
  type ControlAck,
  type ResetLoudnessCommand,
  type SetLevelCommand,
  type SetOnCommand,
} from '@flwc/shared';
import { io } from 'socket.io-client';
import { applyMetersFrame, seedMetersFromSnapshot } from '../store/meter-store.js';
import {
  applyMixerPatch,
  replaceMixerSnapshot,
  setEmberStatus,
  setNotice,
  setSocketConnected,
} from '../store/mixer-store.js';

type SocketListener = (...args: unknown[]) => void;

export interface MixerSocket {
  readonly connected: boolean;
  on(event: string, listener: SocketListener): void;
  off(event: string, listener: SocketListener): void;
  emit(event: string, ...args: unknown[]): void;
  connect(): void;
  disconnect(): void;
}

export function createBrowserSocket(): MixerSocket {
  const socket = io({ autoConnect: false });
  return {
    get connected() {
      return socket.connected;
    },
    on(event, listener) {
      socket.on(event, listener);
    },
    off(event, listener) {
      socket.off(event, listener);
    },
    emit(event, ...args) {
      socket.emit(event, ...args);
    },
    connect() {
      socket.connect();
    },
    disconnect() {
      socket.disconnect();
    },
  };
}

function parseIncoming<T>(
  parser: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  apply: (data: T) => void,
): void {
  const result = parser.safeParse(value);
  if (result.success) {
    apply(result.data);
  } else {
    setNotice('Received invalid data from the server.');
  }
}

export function bindMixerSocket(socket: MixerSocket): () => void {
  const onConnect: SocketListener = () => {
    setSocketConnected(true);
  };
  const onDisconnect: SocketListener = () => {
    setSocketConnected(false);
  };
  const onSnapshot: SocketListener = (payload) => {
    parseIncoming(mixerSnapshotSchema, payload, (snapshot) => {
      const replacedInventory = replaceMixerSnapshot(snapshot);
      if (replacedInventory) {
        seedMetersFromSnapshot(snapshot);
      }
    });
  };
  const onPatch: SocketListener = (payload) => {
    parseIncoming(mixerPatchSchema, payload, applyMixerPatch);
  };
  const onMeters: SocketListener = (payload) => {
    parseIncoming(metersFrameSchema, payload, applyMetersFrame);
  };
  const onStatus: SocketListener = (payload) => {
    parseIncoming(systemStatusSchema, payload, ({ ember }) => {
      setEmberStatus(ember);
    });
  };

  const listeners: Array<[string, SocketListener]> = [
    ['connect', onConnect],
    ['disconnect', onDisconnect],
    [SOCKET_EVENTS.MIXER_SNAPSHOT, onSnapshot],
    [SOCKET_EVENTS.MIXER_PATCH, onPatch],
    [SOCKET_EVENTS.METERS_FRAME, onMeters],
    [SOCKET_EVENTS.SYSTEM_STATUS, onStatus],
  ];
  for (const [event, listener] of listeners) {
    socket.on(event, listener);
  }
  if (socket.connected) {
    setSocketConnected(true);
  }
  socket.connect();

  return () => {
    for (const [event, listener] of listeners) {
      socket.off(event, listener);
    }
    socket.disconnect();
    setSocketConnected(false);
  };
}

const ACK_TIMEOUT_MS = 5000;

function emitWithAck(
  socket: MixerSocket,
  event: string,
  payload: SetLevelCommand | SetOnCommand | ResetLoudnessCommand,
): Promise<ControlAck> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      resolve({
        ok: false,
        error: { code: 'TIMEOUT', message: 'The mixer did not respond.' },
      });
    }, ACK_TIMEOUT_MS);

    const receiveAck = (value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      const parsed = controlAckSchema.safeParse(value);
      resolve(
        parsed.success
          ? parsed.data
          : {
              ok: false,
              error: { code: 'INVALID_ACK', message: 'The mixer sent an invalid response.' },
            },
      );
    };
    socket.emit(event, payload, receiveAck);
  });
}

export interface ControlClient {
  setLevel(command: SetLevelCommand): Promise<ControlAck>;
  setOn(command: SetOnCommand): Promise<ControlAck>;
  resetLoudness(): Promise<ControlAck>;
}

export function createControlClient(socket: MixerSocket): ControlClient {
  return {
    setLevel(command) {
      return emitWithAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, command);
    },
    setOn(command) {
      return emitWithAck(socket, SOCKET_EVENTS.CONTROL_SET_ON, command);
    },
    resetLoudness() {
      return emitWithAck(socket, SOCKET_EVENTS.CONTROL_RESET_LOUDNESS, {});
    },
  };
}
