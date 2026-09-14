import { createRequiredDump, MockEmberProvider } from '@flwc/test-utils';
import {
  SOCKET_EVENTS,
  type MetersFrame,
  type MixerPatch,
  type MixerSnapshot,
  type SystemStatus,
} from '@flwc/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { StartedServer } from '../src/server.js';
import {
  closeTransports,
  createStackHarness,
  delay,
  emitAck,
  nextSnapshotWhere,
  unplugProvider,
  type ClientOptions,
} from './mixer-stack.js';

/** A client that gives up on a dead connection quickly, so a case does not spend a second waiting. */
const FAST_CLIENT: ClientOptions = {
  reconnectionDelay: 50,
  reconnectionDelayMax: 100,
  randomizationFactor: 0,
};

/**
 * How long a broadcast is watched for a duplicate. A loopback round trip is orders of magnitude
 * under this, so anything that has not arrived by the end of it was never sent.
 */
const QUIET_WINDOW_MS = 200;

/**
 * The Ember connect timeout for the cases that have to watch a dial give up. `emberplus-connection`
 * swallows ECONNREFUSED and keeps dialling on its own, so a provider that is simply gone never
 * produces an error: `lastError` appears only once our own timeout fires. One second keeps that
 * wait short while leaving the mock's three-strip tree a wide margin on loopback.
 */
const SHORT_EMBER_TIMEOUT_MS = 1000;

interface Recovery {
  socket: Socket;
  server: StartedServer;
  provider: MockEmberProvider;
  snapshot: MixerSnapshot;
}

describe('mixer reconnect integration', { timeout: 20_000 }, () => {
  const harness = createStackHarness();
  const { providers, startStack, startServer } = harness;

  afterEach(harness.cleanup);

  /** Brings a provider back on the port the old one just left. Reads the port before closing it. */
  function reviveProvider(previous: MockEmberProvider): MockEmberProvider {
    // `provider.port` throws once `close()` clears the bound port, so it is read while it is up.
    const port = previous.port;
    expect(unplugProvider(previous)).toBeGreaterThan(0);
    const revived = MockEmberProvider.fromDump(createRequiredDump(), { port });
    providers.push(revived);
    return revived;
  }

  /** The state both stacked-failure cases have to reach, whichever side came back first. */
  async function assertFullyRecovered({
    socket,
    server,
    provider,
    snapshot,
  }: Recovery): Promise<void> {
    expect(snapshot.connection).toBe('connected');
    expect(snapshot.channels).toHaveLength(3);
    expect(server.runtime.store.connectionError).toBeUndefined();

    const frames: MetersFrame[] = [];
    socket.on(SOCKET_EVENTS.METERS_FRAME, (frame: MetersFrame) => frames.push(frame));
    expect(provider.pushParameter('channel/channel1/meter', -21.5)).toBe(true);
    await expect
      .poll(() =>
        frames.some((frame) =>
          frame.meters.some(([id, value]) => id === 'channel/1' && value === -21.5),
        ),
      )
      .toBe(true);

    expect(
      await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: -7 }),
    ).toEqual({ ok: true });
    await expect
      .poll(() => provider.getParameter('channel/channel1/level')?.contents.value)
      .toBe(-7);
  }

  it('reconnects on its own to a provider that comes back on the same port', async () => {
    const { server, provider, socket, url } = await startStack(createRequiredDump(), {
      timeoutMs: SHORT_EMBER_TIMEOUT_MS,
      clientOptions: FAST_CLIENT,
    });
    const emberPort = provider.port;

    const statuses: SystemStatus[] = [];
    socket.on(SOCKET_EVENTS.SYSTEM_STATUS, (status: SystemStatus) => statuses.push(status));

    expect(unplugProvider(provider)).toBeGreaterThan(0);
    await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');
    await expect.poll(() => statuses.some((status) => status.ember === 'reconnecting')).toBe(true);

    // The desk being gone is not itself a reason. The reason turns up one `timeoutMs` after the
    // first retry, which is why this stack dials with a short one.
    await expect
      .poll(() => server.runtime.store.connectionError, { timeout: 5_000 })
      .toMatch(/^Timeout after \d+ms: connect$/);

    const revived = MockEmberProvider.fromDump(createRequiredDump(), { port: emberPort });
    providers.push(revived);
    const connectedSnapshot = nextSnapshotWhere(socket, (next) => next.connection === 'connected');
    await revived.listen();

    // Nothing here PUTs an endpoint: the service dials the address it already had.
    await expect.poll(() => server.runtime.store.connection, { timeout: 10_000 }).toBe('connected');
    const snapshot = await connectedSnapshot;
    // The tree is identical, so nothing structural changed. This snapshot exists only because
    // reaching `connected` arms one, which is the behaviour 6.1 put in.
    expect(snapshot.channels).toHaveLength(3);
    await expect.poll(() => statuses.at(-1)).toEqual({ ember: 'connected' });

    const connection = (await (await fetch(`${url}/api/v1/connection`)).json()) as {
      status: string;
      lastError?: string;
    };
    expect(connection.status).toBe('connected');
    expect(connection.lastError).toBeUndefined();

    await assertFullyRecovered({ socket, server, provider: revived, snapshot });
  });

  it('is handed a fresh snapshot after a transport close it recovers from by itself', async () => {
    const { server, provider, socket } = await startStack(createRequiredDump(), {
      clientOptions: FAST_CLIENT,
    });

    const reasons: string[] = [];
    socket.on('disconnect', (reason: string) => reasons.push(reason));
    const snapshots: MixerSnapshot[] = [];
    socket.on(SOCKET_EVENTS.MIXER_SNAPSHOT, (snapshot: MixerSnapshot) => snapshots.push(snapshot));
    const statuses: SystemStatus[] = [];
    socket.on(SOCKET_EVENTS.SYSTEM_STATUS, (status: SystemStatus) => statuses.push(status));
    const frames: MetersFrame[] = [];
    socket.on(SOCKET_EVENTS.METERS_FRAME, (frame: MetersFrame) => frames.push(frame));
    let reconnects = 0;
    socket.io.on('reconnect', () => {
      reconnects += 1;
    });

    expect(closeTransports(server)).toBe(1);

    await expect.poll(() => reasons).toEqual(['transport close']);
    await expect.poll(() => socket.connected, { timeout: 10_000 }).toBe(true);
    // The manager's `reconnect` only fires for a dial the client made itself; a manual `connect()`
    // does not raise it. Nothing in this test calls `connect()`.
    expect(reconnects).toBe(1);

    expect(snapshots.at(-1)).toMatchObject({ connection: 'connected' });
    expect(snapshots.at(-1)?.channels).toHaveLength(3);
    expect(statuses.at(-1)).toEqual({ ember: 'connected' });
    // Ember never moved: only the browser's socket went.
    expect(server.runtime.store.connection).toBe('connected');

    expect(provider.pushParameter('channel/channel1/meter', -22)).toBe(true);
    await expect
      .poll(() =>
        frames.some((frame) =>
          frame.meters.some(([id, value]) => id === 'channel/1' && value === -22),
        ),
      )
      .toBe(true);
  });

  it('keeps the inventory for a client that returns before the desk does', async () => {
    const { server, provider, socket } = await startStack(createRequiredDump(), {
      timeoutMs: SHORT_EMBER_TIMEOUT_MS,
      clientOptions: FAST_CLIENT,
    });
    const snapshots: MixerSnapshot[] = [];
    socket.on(SOCKET_EVENTS.MIXER_SNAPSHOT, (snapshot: MixerSnapshot) => snapshots.push(snapshot));

    // The Ember side is settled first, so what this case is about is the order of the *returns*
    // rather than a race between two departures.
    const revived = reviveProvider(provider);
    await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');
    closeTransports(server);

    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBeGreaterThan(0);
    // The client is back within ~50 ms and the desk cannot beat that, so the handshake snapshot
    // says `reconnecting` — and the server does not empty the inventory to say it.
    expect(snapshots[0]).toMatchObject({ connection: 'reconnecting' });
    expect(snapshots[0]?.channels).toHaveLength(3);

    const connected = nextSnapshotWhere(socket, (next) => next.connection === 'connected');
    await revived.listen();

    await assertFullyRecovered({
      socket,
      server,
      provider: revived,
      snapshot: await connected,
    });
  });

  it('hands a client that returns after the desk a connected snapshot straight away', async () => {
    const { server, provider, socket } = await startStack(createRequiredDump(), {
      timeoutMs: SHORT_EMBER_TIMEOUT_MS,
      // Automatic reconnection is off here. This case is about what a client is handed when it
      // comes back *after* the desk, and the automatic return itself is locked by the transport
      // close and server restart cases.
      clientOptions: { reconnection: false },
    });
    const snapshots: MixerSnapshot[] = [];
    socket.on(SOCKET_EVENTS.MIXER_SNAPSHOT, (snapshot: MixerSnapshot) => snapshots.push(snapshot));

    const revived = reviveProvider(provider);
    await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');
    closeTransports(server);
    await expect.poll(() => socket.connected).toBe(false);

    await revived.listen();
    await expect.poll(() => server.runtime.store.connection, { timeout: 10_000 }).toBe('connected');
    // The connected broadcast went out while nobody was listening, so the client missed it whole.
    expect(snapshots).toHaveLength(0);

    socket.connect();
    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBe(1);
    const [first] = snapshots;
    if (first === undefined) {
      throw new Error('the reconnected client was handed no snapshot');
    }
    expect(first).toMatchObject({ connection: 'connected' });

    await assertFullyRecovered({ socket, server, provider: revived, snapshot: first });
  });

  it('lets a client ride out a server restart on the same port', async () => {
    const { server, socket, httpPort, configDir } = await startStack(createRequiredDump(), {
      // A slower retry than the other cases use, so the first dial lands after the old instance
      // has let go of the port rather than racing it.
      clientOptions: { reconnectionDelay: 300, reconnectionDelayMax: 400, randomizationFactor: 0 },
    });
    const snapshots: MixerSnapshot[] = [];
    socket.on(SOCKET_EVENTS.MIXER_SNAPSHOT, (snapshot: MixerSnapshot) => snapshots.push(snapshot));
    let reconnects = 0;
    socket.io.on('reconnect', () => {
      reconnects += 1;
    });

    // The transport goes first, then the server. That order is the point: `app.close()` on its own
    // is a graceful shutdown, and Socket.IO reads a graceful shutdown as "do not wait for me" — the
    // client files it as its own disconnect and never dials again. A machine losing power does not
    // announce anything, it just stops answering, and that is the failure a desk actually sees.
    closeTransports(server);
    // Closing the app runs the `onClose` hook, which stops the runtime with it.
    await server.app.close();
    await expect.poll(() => socket.connected).toBe(false);

    // Same port, same config. The provider never went anywhere, so the new instance finds it.
    await startServer({ httpPort, configDir });

    await expect.poll(() => socket.connected, { timeout: 10_000 }).toBe(true);
    // `app.listen()` runs before `runtime.start()`, so the first snapshot a new instance hands out
    // may still say `connecting` with no channels at all. Only the settled state is asserted.
    await expect.poll(() => snapshots.at(-1)?.connection, { timeout: 10_000 }).toBe('connected');
    expect(snapshots.at(-1)?.channels).toHaveLength(3);
    // Nothing in this test called `connect()`, and the manager only raises `reconnect` for a dial
    // the client made on its own.
    expect(reconnects).toBeGreaterThanOrEqual(1);
  });

  it('holds its listener and broadcast counts through five Ember round trips', async () => {
    const { server, provider, socket } = await startStack(createRequiredDump(), {
      timeoutMs: SHORT_EMBER_TIMEOUT_MS,
    });
    const countListeners = (): Record<string, number> => ({
      emberStatus: server.runtime.ember.listenerCount('status'),
      emberTree: server.runtime.ember.listenerCount('tree'),
      storePatch: server.runtime.store.listenerCount('patch'),
      storeSnapshot: server.runtime.store.listenerCount('snapshot'),
    });
    const before = countListeners();
    // One apiece: the runtime binds `status` and `tree` in its constructor, and the gateway binds
    // `patch` and `snapshot` when it attaches. Both run exactly once per server.
    expect(before).toEqual({ emberStatus: 1, emberTree: 1, storePatch: 1, storeSnapshot: 1 });

    let live = provider;
    for (let round = 0; round < 5; round += 1) {
      const connected = nextSnapshotWhere(socket, (next) => next.connection === 'connected');
      live = reviveProvider(live);
      await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');
      await live.listen();
      await expect
        .poll(() => server.runtime.store.connection, { timeout: 10_000 })
        .toBe('connected');
      expect((await connected).channels).toHaveLength(3);
    }

    const patches: MixerPatch[] = [];
    socket.on(SOCKET_EVENTS.MIXER_PATCH, (patch: MixerPatch) => patches.push(patch));
    expect(live.pushParameter('channel/channel1/level', -17.5)).toBe(true);
    await delay(QUIET_WINDOW_MS);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.upserts).toEqual([
      expect.objectContaining({ id: 'channel/1', levelDb: -17.5 }),
    ]);

    const frames: MetersFrame[] = [];
    socket.on(SOCKET_EVENTS.METERS_FRAME, (frame: MetersFrame) => frames.push(frame));
    expect(live.pushParameter('channel/channel1/meter', -13.5)).toBe(true);
    await delay(QUIET_WINDOW_MS);
    expect(frames.flatMap((frame) => frame.meters).filter(([id]) => id === 'channel/1')).toEqual([
      ['channel/1', -13.5],
    ]);

    expect(countListeners()).toEqual(before);
  });

  it('refuses control commands while Ember is reconnecting', async () => {
    const { server, provider, socket } = await startStack(createRequiredDump(), {
      timeoutMs: SHORT_EMBER_TIMEOUT_MS,
    });
    const levelBefore = server.runtime.store.getChannel('channel/1')?.levelDb;
    expect(levelBefore).toBeTypeOf('number');

    const revived = reviveProvider(provider);
    await expect.poll(() => server.runtime.store.connection).toBe('reconnecting');

    // The write reaches `requireClient()`, which throws `EmberProtocolError`; the gateway turns
    // that into a PROTOCOL ack rather than an internal one.
    expect(
      await emitAck(socket, SOCKET_EVENTS.CONTROL_SET_LEVEL, { id: 'channel/1', levelDb: -9 }),
    ).toMatchObject({ ok: false, error: { code: 'PROTOCOL' } });
    // The store is written only once the Ember write returns, so nothing moved here either.
    expect(server.runtime.store.getChannel('channel/1')?.levelDb).toBe(levelBefore);

    await revived.listen();
    await expect.poll(() => server.runtime.store.connection, { timeout: 10_000 }).toBe('connected');
    // Nothing was queued behind the refusal: the desk comes back at the level it left.
    expect(revived.getParameter('channel/channel1/level')?.contents.value).toBe(levelBefore);
  });
});
