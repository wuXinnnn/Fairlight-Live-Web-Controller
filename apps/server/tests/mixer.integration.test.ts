import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createRequiredDump,
  dumpNodeToEmber,
  findFreePort,
  MockEmberProvider,
} from '@flwc/test-utils';
import { SOCKET_EVENTS, type ControlAck, type MixerPatch, type MixerSnapshot } from '@flwc/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { DumpTree } from '@flwc/test-utils';
import { start, type StartedServer } from '../src/server.js';

async function writeConfig(dir: string, host: string, port: number): Promise<void> {
  await writeFile(
    path.join(dir, 'config.json'),
    `${JSON.stringify({ version: 1, ember: { host, port }, views: [] }, null, 2)}\n`,
    'utf8',
  );
}

function extraChannelDump(): DumpTree {
  const dump = createRequiredDump();
  const channelRoot = dump.nodes.find((node) => node.identifier === 'channel');
  const first = channelRoot?.children?.[0];
  if (channelRoot === undefined || first === undefined) {
    throw new Error('required dump missing channel strip');
  }
  channelRoot.children = [
    first,
    {
      ...first,
      number: 2,
      identifier: 'channel2',
      identifierPath: 'channel/channel2',
      numberPath: `${channelRoot.numberPath}.2`,
      description: 'PC',
      children: first.children?.map((child) => ({
        ...child,
        numberPath: `${channelRoot.numberPath}.2.${child.number}`,
        identifierPath: `channel/channel2/${child.identifier ?? child.number}`,
        value: child.identifier === 'name' ? 'PC' : child.value,
      })),
    },
  ];
  return dump;
}

function extraStripNode() {
  const dump = extraChannelDump();
  const channelRoot = dump.nodes.find((node) => node.identifier === 'channel');
  const added = channelRoot?.children?.find((node) => node.identifier === 'channel2');
  if (added === undefined) {
    throw new Error('extra channel dump missing channel2');
  }
  return dumpNodeToEmber(added);
}

describe('mixer backend integration', { timeout: 15_000 }, () => {
  const providers: MockEmberProvider[] = [];
  const servers: StartedServer[] = [];
  const sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await Promise.all(servers.splice(0).map((server) => server.app.close()));
    for (const provider of providers.splice(0)) {
      provider.close();
    }
  });

  async function startStack(
    dump: DumpTree = createRequiredDump(),
    extra: { incompleteStripRetryMs?: number } = {},
  ): Promise<{
    server: StartedServer;
    provider: MockEmberProvider;
    socket: Socket;
    url: string;
    snapshot: MixerSnapshot;
  }> {
    const provider = MockEmberProvider.fromDump(dump);
    providers.push(provider);
    const { host, port } = await provider.listen();
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-int-'));
    await writeConfig(dir, host, port);
    const httpPort = await findFreePort('127.0.0.1');
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      configDir: dir,
      silent: true,
      timeoutMs: 3000,
      disconnectTimeoutMs: 500,
      reconnectInitialMs: 50,
      reconnectMaxMs: 100,
      treeRefreshDebounceMs: 20,
      incompleteStripRetryMs: extra.incompleteStripRetryMs,
      busDirectoryPollMs: 0,
    });
    servers.push(server);
    const url = `http://127.0.0.1:${httpPort}`;
    const { socket, snapshot } = await connectClient(url);
    return { server, provider, socket, url, snapshot };
  }

  async function connectClient(url: string): Promise<{ socket: Socket; snapshot: MixerSnapshot }> {
    const socket = io(url, { transports: ['websocket'], autoConnect: false });
    sockets.push(socket);
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const snapshot = waitFor<MixerSnapshot>(socket, SOCKET_EVENTS.MIXER_SNAPSHOT);
    socket.connect();
    await connected;
    return { socket, snapshot: await snapshot };
  }

  function waitFor<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
    });
  }

  function emitAck(socket: Socket, event: string, payload: unknown): Promise<ControlAck> {
    return new Promise((resolve) => {
      socket.emit(event, payload, (ack: ControlAck) => resolve(ack));
    });
  }

  it('covers connect, control round-trips, illegal commands, meters, and reconnect', async () => {
    const { server, provider, socket, snapshot, url } = await startStack();
    expect(snapshot.channels.map((channel) => channel.id).sort()).toEqual([
      'aux/1',
      'channel/1',
      'main/1',
    ]);
    expect(snapshot.loudness.integratedLufs).toBe(-23);
    await expect.poll(() => server.runtime.store.connection).toBe('connected');

    const levelPatch = waitFor<MixerPatch>(socket, SOCKET_EVENTS.MIXER_PATCH);
    const levelAck = await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, {
      id: 'channel/1',
      levelDb: -3,
    });
    expect(levelAck).toEqual({ ok: true });
    expect((await levelPatch).upserts?.[0]).toMatchObject({ id: 'channel/1', levelDb: -3 });
    expect(provider.getParameter('channel/channel1/level')?.contents.value).toBe(-3);

    const mutePatch = waitFor<MixerPatch>(socket, SOCKET_EVENTS.MIXER_PATCH);
    const onAck = await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_ON, {
      id: 'channel/1',
      on: false,
    });
    expect(onAck).toEqual({ ok: true });
    expect((await mutePatch).upserts?.[0]).toMatchObject({ muted: true });

    const resetAck = await emitAck(socket, SOCKET_EVENTS.CONTROL_RESET_LOUDNESS, {});
    expect(resetAck).toEqual({ ok: true });
    await expect
      .poll(() => provider.getParameter('system/loudness/integrated')?.contents.value)
      .toBe(-60);

    expect(
      await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: 99 }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/99', levelDb: 0 }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const frames: Array<{ meters: Array<[string, number]> }> = [];
    socket.on(SOCKET_EVENTS.METERS_FRAME, (frame: { meters: Array<[string, number]> }) => {
      frames.push(frame);
    });
    expect(provider.pushParameter('channel/channel1/meter', -12.5)).toBe(true);
    await expect.poll(() => server.runtime.store.getChannel('channel/1')?.meterDb).toBe(-12.5);
    await expect
      .poll(() =>
        frames.some((frame) =>
          frame.meters.some(([id, value]) => id === 'channel/1' && value === -12.5),
        ),
      )
      .toBe(true);

    const deadPort = await findFreePort('127.0.0.1');
    const disconnect = await fetch(`${url}/api/v1/connection`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: deadPort }),
    });
    expect(disconnect.status).toBe(200);
    await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');
  });

  it('emits a snapshot when the provider adds and offlines a channel', async () => {
    const { server, provider } = await startStack();
    expect(server.runtime.store.getChannel('channel/2')).toBeUndefined();
    expect(provider.addNode('channel', extraStripNode())).toBe(true);
    await expect.poll(() => server.runtime.store.getChannel('channel/2')?.name).toBe('PC');
    expect(provider.setNodeOnline('channel/channel2', false)).toBe(true);
    await expect.poll(() => server.runtime.store.getChannel('channel/2')).toBeUndefined();
  });

  it('discovers a strip that arrives as an empty stub then gains parameters', async () => {
    const { server, provider } = await startStack(createRequiredDump(), {
      incompleteStripRetryMs: 80,
    });
    const complete = extraStripNode();
    const parameters = complete.children;
    complete.children = {};
    expect(provider.addNode('channel', complete)).toBe(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(server.runtime.store.getChannel('channel/2')).toBeUndefined();

    const live = provider.getNode('channel/channel2');
    expect(live).toBeDefined();
    if (live === undefined || parameters === undefined) {
      return;
    }
    live.children = parameters;
    for (const child of Object.values(parameters)) {
      child.parent = live;
    }

    await expect
      .poll(() => server.runtime.store.getChannel('channel/2')?.name, { timeout: 3_000 })
      .toBe('PC');
  });

  it('emits a new snapshot after reconnecting to a tree with an added channel', async () => {
    const first = MockEmberProvider.fromDump(createRequiredDump());
    providers.push(first);
    const firstBind = await first.listen();
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-tree-'));
    await writeConfig(dir, firstBind.host, firstBind.port);
    const httpPort = await findFreePort('127.0.0.1');
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      configDir: dir,
      silent: true,
      timeoutMs: 3000,
      disconnectTimeoutMs: 500,
      reconnectInitialMs: 40,
      reconnectMaxMs: 80,
      busDirectoryPollMs: 0,
    });
    servers.push(server);
    await connectClient(`http://127.0.0.1:${httpPort}`);
    expect(server.runtime.store.getChannel('channel/2')).toBeUndefined();

    const second = MockEmberProvider.fromDump(extraChannelDump());
    providers.push(second);
    const next = await second.listen();
    const updated = await fetch(`http://127.0.0.1:${httpPort}/api/v1/connection`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: next.host, port: next.port }),
    });
    expect(updated.status).toBe(200);
    first.close();
    await expect
      .poll(() => server.runtime.store.getChannel('channel/2')?.name, { timeout: 8_000 })
      .toBe('PC');
  });

  it('accepts concurrent level writes without crashing', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    providers.push(provider);
    const { host, port } = await provider.listen();
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-concurrent-'));
    await writeConfig(dir, host, port);
    const httpPort = await findFreePort('127.0.0.1');
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      configDir: dir,
      silent: true,
      timeoutMs: 3000,
      busDirectoryPollMs: 0,
    });
    servers.push(server);
    const { socket } = await connectClient(`http://127.0.0.1:${httpPort}`);

    const acks = await Promise.all([
      emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: -4 }),
      emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: -5 }),
      emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'main/1', levelDb: -2 }),
    ]);
    expect(acks.every((ack) => ack.ok)).toBe(true);
    await expect
      .poll(() => provider.getParameter('channel/channel1/level')?.contents.value)
      .toBe(-5);
  });

  it('serves connection GET/PUT against a live mock provider', async () => {
    const { server, url } = await startStack();
    const current = await fetch(`${url}/api/v1/connection`);
    expect(current.status).toBe(200);
    const body = (await current.json()) as { host: string; port: number; status: string };
    expect(body.status).toBe('connected');

    const nextProvider = MockEmberProvider.fromDump(createRequiredDump());
    providers.push(nextProvider);
    const next = await nextProvider.listen();
    const updated = await fetch(`${url}/api/v1/connection`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: next.host, port: next.port }),
    });
    expect(updated.status).toBe(200);
    await expect
      .poll(() => server.runtime.ember.endpoint)
      .toEqual({
        host: next.host,
        port: next.port,
      });
  });
});
