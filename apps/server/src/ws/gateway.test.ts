import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SOCKET_EVENTS } from '@flwc/shared';
import { ChannelNotFoundError, EmberProtocolError } from '../ember/errors.js';
import { MixerStateStore } from '../state/mixer-state-store.js';
import { MeterHub } from '../state/meter-hub.js';
import { attachGateway } from './gateway.js';
import { silentLogger } from '../logger.js';
import type { MixerRuntime } from '../runtime.js';
import type { Server } from 'socket.io';

class FakeSocket extends EventEmitter {
  emitted: Array<[string, unknown]> = [];

  override emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push([event, args[0]]);
    return super.emit(event, ...args);
  }
}

class FakeIo extends EventEmitter {
  volatile = { emit: vi.fn() };
  emitted: Array<[string, unknown]> = [];

  override emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push([event, args[0]]);
    return super.emit(event, ...args);
  }
}

function stubRuntime(overrides: Partial<MixerRuntime> = {}): MixerRuntime {
  const store = new MixerStateStore();
  const meters = new MeterHub(() => undefined);
  return {
    store,
    meters,
    setLevel: vi.fn(async () => undefined),
    setOn: vi.fn(async () => undefined),
    resetLoudness: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MixerRuntime;
}

describe('attachGateway', () => {
  it('sends a snapshot on connect and relays store events', () => {
    const io = new FakeIo();
    const runtime = stubRuntime();
    attachGateway(io as unknown as Server, runtime, silentLogger());
    const socket = new FakeSocket();
    io.emit('connection', socket);
    expect(socket.emitted[0]?.[0]).toBe(SOCKET_EVENTS.MIXER_SNAPSHOT);

    runtime.store.applySync({
      added: [
        {
          id: 'channel/1',
          kind: 'channel',
          name: 'BASS',
          levelDb: -6,
          muted: false,
          meterDb: -20,
        },
      ],
      updated: [],
      removedIds: [],
      loudness: undefined,
      structureChanged: true,
    });
    expect(io.emitted.some(([event]) => event === SOCKET_EVENTS.MIXER_SNAPSHOT)).toBe(true);
    runtime.store.setLevel('channel/1', -1);
    expect(io.emitted.some(([event]) => event === SOCKET_EVENTS.MIXER_PATCH)).toBe(true);
    runtime.store.setConnection('connected');
    expect(io.emitted.some(([event]) => event === SOCKET_EVENTS.SYSTEM_STATUS)).toBe(true);
    runtime.meters.ingestMeter('channel/1', -5);
    runtime.meters.flush();
    expect(io.volatile.emit).toHaveBeenCalled();
  });

  it('acks validation and business errors for control commands', async () => {
    const io = new FakeIo();
    const runtime = stubRuntime({
      setLevel: vi.fn(async (id: string) => {
        if (id === 'missing') {
          throw new ChannelNotFoundError(id);
        }
        throw new EmberProtocolError('down');
      }),
      setOn: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    attachGateway(io as unknown as Server, runtime, silentLogger());
    const socket = new FakeSocket();
    io.emit('connection', socket);

    const invalid = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: 99 }, resolve);
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

    const missing = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'missing', levelDb: 0 }, resolve);
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const down = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: 0 }, resolve);
    });
    expect(down).toMatchObject({ ok: false, error: { code: 'PROTOCOL' } });

    const boom = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_SET_ON, { id: 'channel/1', on: true }, resolve);
    });
    expect(boom).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });

    const resetInvalid = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_RESET_LOUDNESS, 1, resolve);
    });
    expect(resetInvalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('acks successful control commands and ignores a missing ack', async () => {
    const io = new FakeIo();
    const setOn = vi.fn(async () => undefined);
    const resetLoudness = vi.fn(async () => undefined);
    const runtime = stubRuntime({ setOn, resetLoudness });
    attachGateway(io as unknown as Server, runtime, silentLogger());
    const socket = new FakeSocket();
    io.emit('connection', socket);
    const ack = await new Promise((resolve) => {
      socket.emit(SOCKET_EVENTS.CONTROL_SET_ON, { id: 'channel/1', on: true }, resolve);
    });
    expect(ack).toEqual({ ok: true });
    expect(setOn).toHaveBeenCalledWith('channel/1', true);
    socket.emit(SOCKET_EVENTS.CONTROL_RESET_LOUDNESS, {});
    await expect.poll(() => resetLoudness.mock.calls.length).toBe(1);
  });
});
