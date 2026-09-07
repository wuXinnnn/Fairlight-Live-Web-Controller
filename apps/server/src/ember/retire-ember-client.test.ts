import { EmberClient } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import { FakeEmberClient } from './fake-ember-client.js';
import {
  captureEmberTransport,
  retireEmberTransport,
  type EmberTransport,
} from './retire-ember-client.js';
import type { EmberClientHandle } from './types.js';

describe('retireEmberTransport', () => {
  it('stops every way the library could dial again and destroys the socket', () => {
    const socket = { destroy: vi.fn(), removeAllListeners: vi.fn() };
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
    expect(transport.connect?.()).resolves.toBeUndefined();
    clearInterval(interval);
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
