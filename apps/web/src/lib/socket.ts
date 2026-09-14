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

/** How long a command waits for the desk to answer, on the transport and in the promise alike. */
export const ACK_TIMEOUT_MS = 5000;

const TIMEOUT_ACK: ControlAck = {
  ok: false,
  error: { code: 'TIMEOUT', message: 'The mixer did not respond.' },
};

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
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        socket.emit(event, ...args);
        return;
      }
      /*
       * Socket.IO buffers a packet it cannot send now and replays it once the socket is back. A
       * fader let go of a second before the network dropped would reach the desk minutes later,
       * long after the UI gave up on it and rolled the strip back, and nobody would be touching
       * the tablet when it moved. Only a packet sent with a timeout is dropped from that buffer,
       * so every command that expects an answer goes out with one.
       *
       * A timed acknowledgement arrives as `(err, ...response)`: on timeout `err` is an Error and
       * there is no response at all, otherwise `err` is null and `response[0]` is the desk's
       * answer. The failure is translated here rather than handed to the acknowledgement parser,
       * which would see an Error, fail to recognise it and call it an invalid response.
       */
      const deliver = callback as (ack: unknown) => void;
      const payload = args.slice(0, -1);
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit(event, ...payload, (error: Error | null, ...response: unknown[]) => {
          deliver(error === null || error === undefined ? response[0] : TIMEOUT_ACK);
        });
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
    parseIncoming(systemStatusSchema, payload, ({ ember, lastError }) => {
      setEmberStatus(ember, lastError);
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

function emitWithAck(
  socket: MixerSocket,
  event: string,
  payload: SetLevelCommand | SetOnCommand | ResetLoudnessCommand,
): Promise<ControlAck> {
  /*
   * A command handed to a socket that is down is not sent, it is queued. This app does not replay
   * queued commands on reconnect — replaying a stale level is an accident, not a feature — so the
   * command fails here instead, before `emit` is ever reached. Nothing is sent, no timer is
   * started, and the strip rolls back on the next microtask.
   */
  if (!socket.connected) {
    return Promise.resolve({
      ok: false,
      error: { code: 'OFFLINE', message: 'The mixer is offline.' },
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    /*
     * Kept alongside the transport timeout above, because they are not the same guarantee and not
     * every socket has both. `MixerSocket` is an interface: a test double, or any implementation
     * that is not the browser client, has no `timeout()` at all, and the promise still has to
     * settle for the caller. The transport timer drops the packet from the send buffer, which this
     * one cannot do; this one answers the caller, which that one cannot do on such a socket. They
     * resolve to the same acknowledgement, and `settled` makes whichever arrives first the one
     * that counts.
     */
    const timeout = window.setTimeout(() => {
      settled = true;
      resolve(TIMEOUT_ACK);
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
