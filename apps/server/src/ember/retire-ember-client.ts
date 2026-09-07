import type { EmberClientHandle } from './types.js';

/** The subset of emberplus-connection's S101Client that keeps a discarded client dialling. */
export interface EmberTransport {
  _autoReconnect?: boolean;
  _shouldBeConnected?: boolean;
  _connectionAttemptTimer?: ReturnType<typeof setInterval>;
  socket?: { destroy(): void; removeAllListeners(): void };
  connect?: (...args: unknown[]) => Promise<unknown>;
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
 */
export function retireEmberTransport(transport: EmberTransport | undefined): void {
  if (transport === undefined) {
    return;
  }
  transport._autoReconnect = false;
  transport._shouldBeConnected = false;
  if (transport._connectionAttemptTimer !== undefined) {
    clearInterval(transport._connectionAttemptTimer);
    transport._connectionAttemptTimer = undefined;
  }
  transport.connect = async () => undefined;
  const socket = transport.socket;
  if (socket !== undefined) {
    socket.removeAllListeners();
    socket.destroy();
    transport.socket = undefined;
  }
}
