import { SOCKET_EVENTS } from '@flwc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '../../tests/fake-socket.js';

const socketIoMock = vi.hoisted(() => ({
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  timeout: vi.fn(() => socketIoMock),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketIoMock),
}));

import {
  ACK_TIMEOUT_MS,
  bindMixerSocket,
  createBrowserSocket,
  createControlClient,
  type MixerSocket,
} from './socket.js';
import { meterStore, resetMeterStore } from '../store/meter-store.js';
import { mixerStore, resetMixerStore } from '../store/mixer-store.js';

describe('socket client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetMixerStore();
    resetMeterStore();
  });

  it('adapts the browser Socket.IO client transport', () => {
    const browserSocket = createBrowserSocket();
    const listener = vi.fn();
    browserSocket.on('event', listener);
    browserSocket.emit('event', { ok: true });
    browserSocket.off('event', listener);
    browserSocket.connect();
    browserSocket.disconnect();

    expect(browserSocket.connected).toBe(false);
    expect(socketIoMock.on).toHaveBeenCalledWith('event', listener);
    expect(socketIoMock.emit).toHaveBeenCalled();
    expect(socketIoMock.off).toHaveBeenCalled();
    expect(socketIoMock.connect).toHaveBeenCalled();
    expect(socketIoMock.disconnect).toHaveBeenCalled();
  });

  it('keeps seeded meters when an empty reconnect handshake is retained', () => {
    const socket = new FakeSocket();
    bindMixerSocket(socket);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, {
      channels: [
        {
          id: 'channel/1',
          kind: 'channel',
          name: 'BASS',
          levelDb: -12,
          muted: false,
          meterDb: -28,
        },
      ],
      loudness: { integratedLufs: -23, truePeakDbtp: -5 },
      connection: 'connected',
    });
    expect(meterStore.getState().meters['channel/1']).toBe(-28);

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, {
      channels: [],
      loudness: { integratedLufs: 0, truePeakDbtp: 0 },
      connection: 'disconnected',
    });
    expect(mixerStore.getState().channels['channel/1']?.name).toBe('BASS');
    expect(mixerStore.getState().emberStatus).toBe('disconnected');
    expect(meterStore.getState().meters['channel/1']).toBe(-28);
    expect(meterStore.getState().loudness.integratedLufs).toBe(-23);
  });

  it('binds status events and removes all listeners during cleanup', () => {
    const socket = new FakeSocket();
    const cleanup = bindMixerSocket(socket);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, {
      ember: 'reconnecting',
      lastError: 'Timeout after 5000ms: connect',
    });
    expect(mixerStore.getState().emberStatus).toBe('reconnecting');
    expect(mixerStore.getState().emberLastError).toBe('Timeout after 5000ms: connect');
    expect(mixerStore.getState().socketConnected).toBe(true);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'reconnecting' });
    expect(mixerStore.getState().emberLastError).toBeNull();

    cleanup();
    expect(mixerStore.getState().socketConnected).toBe(false);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    expect(mixerStore.getState().emberStatus).toBe('reconnecting');
  });

  it('times out commands that never receive an acknowledgement', async () => {
    vi.useFakeTimers();
    const socket: MixerSocket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const resultPromise = createControlClient(socket).resetLoudness();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
  });

  it('rejects malformed acknowledgements', async () => {
    const socket: MixerSocket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: (_event, ...args) => {
        const callback = args.at(-1);
        if (typeof callback === 'function') {
          callback({ unexpected: true });
        }
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    await expect(
      createControlClient(socket).setOn({ id: 'channel/1', on: true }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACK' },
    });
  });
  it('fails every control command while the socket is down instead of queueing it', async () => {
    const emit = vi.fn();
    const socket: MixerSocket = {
      connected: false,
      on: vi.fn(),
      off: vi.fn(),
      emit,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const client = createControlClient(socket);

    const offline = { ok: false, error: { code: 'OFFLINE', message: 'The mixer is offline.' } };
    await expect(client.setLevel({ id: 'channel/1', levelDb: -6 })).resolves.toEqual(offline);
    await expect(client.setOn({ id: 'channel/1', on: false })).resolves.toEqual(offline);
    await expect(client.resetLoudness()).resolves.toEqual(offline);
    // Nothing reached the transport, so Socket.IO has nothing to replay on reconnect.
    expect(emit).not.toHaveBeenCalled();
  });

  it('sends commands with a transport timeout and translates its acknowledgement', () => {
    const socket = createBrowserSocket();
    const receive = vi.fn();
    socket.emit(SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: -6 }, receive);

    expect(socketIoMock.timeout).toHaveBeenCalledWith(ACK_TIMEOUT_MS);
    const call = socketIoMock.emit.mock.calls.at(-1);
    expect(call?.[0]).toBe(SOCKET_EVENTS.CONTROL_SET_LEVEL);
    expect(call?.[1]).toEqual({ id: 'channel/1', levelDb: -6 });

    const translate = call?.at(-1) as (error: Error | null, ...response: unknown[]) => void;
    translate(new Error('operation has timed out'));
    expect(receive).toHaveBeenLastCalledWith({
      ok: false,
      error: { code: 'TIMEOUT', message: 'The mixer did not respond.' },
    });

    translate(null, { ok: true });
    expect(receive).toHaveBeenLastCalledWith({ ok: true });
  });

  it('leaves an emit without an acknowledgement on the plain transport', () => {
    const socket = createBrowserSocket();
    socket.emit('some:event', { value: 1 });

    expect(socketIoMock.timeout).not.toHaveBeenCalled();
    expect(socketIoMock.emit).toHaveBeenLastCalledWith('some:event', { value: 1 });
  });
});
