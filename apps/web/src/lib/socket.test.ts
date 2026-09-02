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
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketIoMock),
}));

import {
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
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'reconnecting' });
    expect(mixerStore.getState().emberStatus).toBe('reconnecting');
    expect(mixerStore.getState().socketConnected).toBe(true);

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
});
