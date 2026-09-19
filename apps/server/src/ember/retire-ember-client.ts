import type { EmberClientHandle } from './types.js';

/** The parts of the `net.Socket` behind an S101 transport that retiring it touches. */
export interface EmberTransportSocket {
  destroyed?: boolean;
  destroy(): void;
  /** Node >= 18.3: closes with RST instead of FIN. Absent, `destroy()` is used instead. */
  resetAndDestroy?(): void;
  removeAllListeners(): void;
  on?(event: 'error', listener: (error: Error) => void): unknown;
  once?(event: 'error', listener: (error: Error) => void): unknown;
}

/** The subset of emberplus-connection's S101Client that keeps a discarded client dialling. */
export interface EmberTransport {
  _autoReconnect?: boolean;
  _shouldBeConnected?: boolean;
  _connectionAttemptTimer?: ReturnType<typeof setInterval>;
  keepaliveIntervalTimer?: ReturnType<typeof setInterval>;
  keepaliveResponseWindowTimer?: ReturnType<typeof setTimeout> | null;
  socket?: EmberTransportSocket;
  connect?: (...args: unknown[]) => Promise<unknown>;
}

export interface RetireEmberTransportOptions {
  /**
   * Close the socket with a TCP reset instead of a FIN. Fairlight Live never closes its side of
   * a session that was ended with a FIN, so every short-lived connection to it has to go this way.
   */
  reset?: boolean;
}

/**
 * Captures the S101 transport behind an emberplus-connection client. Must run before
 * `discard()`, which deletes the client's reference to it.
 */
export function captureEmberTransport(client: EmberClientHandle): EmberTransport | undefined {
  const inner = (client as { _client?: unknown })._client;
  return typeof inner === 'object' && inner !== null ? (inner as EmberTransport) : undefined;
}

/**
 * emberplus-connection@0.3.1 keeps a discarded client alive: its connect-timeout listener and
 * its auto-reconnect interval both call `connect()` again, and `disconnect()` only ends the
 * socket (a dialling one is left untouched). A retired client could therefore reach the mixer
 * ahead of the live one and hold its connection while answering keepalives. Silence it for good.
 *
 * The keepalive timers are cleared here too. The library clears them in `disconnect()`, but a
 * transport retired before `disconnect()` runs (the probe does exactly that, so that the library
 * never sends a FIN) would otherwise keep its ten second keepalive interval for the rest of the
 * process, one per probe.
 */
export function retireEmberTransport(
  transport: EmberTransport | undefined,
  options: RetireEmberTransportOptions = {},
): void {
  if (transport === undefined) {
    return;
  }
  transport._autoReconnect = false;
  transport._shouldBeConnected = false;
  if (transport._connectionAttemptTimer !== undefined) {
    clearInterval(transport._connectionAttemptTimer);
    transport._connectionAttemptTimer = undefined;
  }
  if (transport.keepaliveIntervalTimer !== undefined) {
    clearInterval(transport.keepaliveIntervalTimer);
    transport.keepaliveIntervalTimer = undefined;
  }
  if (transport.keepaliveResponseWindowTimer != null) {
    clearTimeout(transport.keepaliveResponseWindowTimer);
    transport.keepaliveResponseWindowTimer = null;
  }
  transport.connect = async () => undefined;
  const socket = transport.socket;
  if (socket !== undefined) {
    socket.removeAllListeners();
    // Nothing listens any more, and a late error on a socket being torn down must not throw.
    socket.on?.('error', () => undefined);
    if (
      options.reset === true &&
      socket.destroyed !== true &&
      typeof socket.resetAndDestroy === 'function'
    ) {
      socket.resetAndDestroy();
    } else {
      socket.destroy();
    }
    transport.socket = undefined;
  }
}
