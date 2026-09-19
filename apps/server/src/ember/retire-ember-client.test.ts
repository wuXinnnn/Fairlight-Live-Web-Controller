import { EmberClient } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import { FakeEmberClient } from './fake-ember-client.js';
import {
  captureEmberTransport,
  retireEmberTransport,
  type EmberTransport,
  type EmberTransportSocket,
} from './retire-ember-client.js';
import type { EmberClientHandle } from './types.js';

function fakeSocket(extra: Partial<EmberTransportSocket> = {}) {
  return { destroy: vi.fn(), removeAllListeners: vi.fn(), on: vi.fn(), ...extra };
}

describe('retireEmberTransport', () => {
  it('stops every way the library could dial again and destroys the socket', () => {
    const socket = fakeSocket();
    const interval = setInterval(() => undefined, 60_000);
    const transport: EmberTransport = {
      _autoReconnect: true,
      _shouldBeConnected: true,
      _connectionAttemptTimer: interval,
      socket,
      connect: vi.fn(async () => 'dialled'),
    };
    retireEmberTransport(transport);
    expect(transport._autoReconnect).toBe(false);
    expect(transport._shouldBeConnected).toBe(false);
    expect(transport._connectionAttemptTimer).toBeUndefined();
    expect(transport.socket).toBeUndefined();
    expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(transport.connect?.()).resolves.toBeUndefined();
    clearInterval(interval);
  });

  it('closes with a reset when asked to, and falls back to destroy where there is none', () => {
    const resettable = fakeSocket({ resetAndDestroy: vi.fn() });
    retireEmberTransport({ socket: resettable }, { reset: true });
    expect(resettable.resetAndDestroy).toHaveBeenCalledTimes(1);
    expect(resettable.destroy).not.toHaveBeenCalled();

    const plain = fakeSocket();
    retireEmberTransport({ socket: plain }, { reset: true });
    expect(plain.destroy).toHaveBeenCalledTimes(1);

    // A socket that is already gone has nothing to reset; resetting it would raise an error.
    const gone = fakeSocket({ resetAndDestroy: vi.fn(), destroyed: true });
    retireEmberTransport({ socket: gone }, { reset: true });
    expect(gone.resetAndDestroy).not.toHaveBeenCalled();
    expect(gone.destroy).toHaveBeenCalledTimes(1);
  });

  it('clears the keepalive timers the library would only clear in disconnect()', () => {
    const interval = setInterval(() => undefined, 10_000);
    const window = setTimeout(() => undefined, 500);
    const transport: EmberTransport = {
      keepaliveIntervalTimer: interval,
      keepaliveResponseWindowTimer: window,
    };
    retireEmberTransport(transport);
    expect(transport.keepaliveIntervalTimer).toBeUndefined();
    expect(transport.keepaliveResponseWindowTimer).toBeNull();
    // Cleared timers are harmless to clear again; a leaked one would keep the process alive.
    clearInterval(interval);
    clearTimeout(window);
  });

  it('tolerates clients without a transport', () => {
    expect(captureEmberTransport(new FakeEmberClient())).toBeUndefined();
    expect(() => retireEmberTransport(undefined)).not.toThrow();
    expect(() => retireEmberTransport({})).not.toThrow();
  });

  it('finds the transport of the real library client and silences its redial', async () => {
    const client = new EmberClient('127.0.0.1', 1, 100) as unknown as EmberClientHandle;
    const transport = captureEmberTransport(client);
    expect(transport).toBeDefined();
    expect(typeof transport?.connect).toBe('function');
    const dialling = client.connect();
    expect(transport?.socket).toBeDefined();
    client.discard();
    retireEmberTransport(transport);
    // The library's own connect timeout would call connect() again; it is a no-op now.
    await expect(transport?.connect?.()).resolves.toBeUndefined();
    expect(transport?.socket).toBeUndefined();
    await Promise.race([dialling.catch(() => undefined), new Promise((r) => setTimeout(r, 50))]);
  });
});
