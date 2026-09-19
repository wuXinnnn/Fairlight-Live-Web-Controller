import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequiredDump, findFreePort, MockEmberProvider } from '@flwc/test-utils';
import type { DumpTree, MockEmberProviderOptions } from '@flwc/test-utils';
import { SOCKET_EVENTS, type ControlAck, type MixerSnapshot } from '@flwc/shared';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { start, type StartedServer } from '../src/server.js';

export type ClientOptions = Partial<ManagerOptions & SocketOptions>;

export interface StartStackOptions {
  incompleteStripRetryMs?: number;
  /** A fixed HTTP port, so a client can keep dialling the address a restarted server comes back on. */
  httpPort?: number;
  /** A fixed provider port, so a provider can come back on the address it left. */
  providerPort?: number;
  /** Merged into `io()`. Reconnect cases shorten the client's backoff with it. */
  clientOptions?: ClientOptions;
  /**
   * The Ember connect/expand/subscribe timeout. A case that has to watch a dial give up lowers it,
   * because `lastError` does not exist until one does.
   */
  timeoutMs?: number;
  /** How often the mixer strip probe runs. Zero, the default here, turns it off. */
  busDirectoryPollMs?: number;
  /** Handed to the provider as is, for the cases that want it to behave like a busy desk. */
  providerOptions?: MockEmberProviderOptions;
}

export interface Stack {
  server: StartedServer;
  provider: MockEmberProvider;
  socket: Socket;
  url: string;
  httpPort: number;
  configDir: string;
  snapshot: MixerSnapshot;
}

export interface StackHarness {
  /** Exposed so a case can register a stack it built by hand and still be torn down with the rest. */
  readonly providers: MockEmberProvider[];
  readonly servers: StartedServer[];
  readonly sockets: Socket[];
  startStack(dump?: DumpTree, extra?: StartStackOptions): Promise<Stack>;
  startServer(options: {
    httpPort: number;
    configDir: string;
    extra?: StartStackOptions;
  }): Promise<StartedServer>;
  connectClient(
    url: string,
    clientOptions?: ClientOptions,
  ): Promise<{ socket: Socket; snapshot: MixerSnapshot }>;
  cleanup(): Promise<void>;
}

export async function writeConfig(dir: string, host: string, port: number): Promise<void> {
  await writeFile(
    path.join(dir, 'config.json'),
    `${JSON.stringify({ version: 1, ember: { host, port }, views: [] }, null, 2)}\n`,
    'utf8',
  );
}

export function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

export function emitAck(socket: Socket, event: string, payload: unknown): Promise<ControlAck> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack: ControlAck) => resolve(ack));
  });
}

/**
 * Pulls a provider's network out from under whoever is talking to it, then stops it listening.
 *
 * `MockEmberProvider.close()` on its own is not enough to play a desk going away: it reaches
 * `S101Server.discard()`, which closes the listening socket and nothing else, and by Node's rules
 * an established connection survives that untouched. A service on the other end would go on
 * holding a live socket to a provider that is no longer there and would never reconnect. Losing
 * power drops the connections first, so that is the order here.
 *
 * Reaching for `_clients` is how the mock already talks to its connected clients (see
 * `notifyInserted`), so this is the same private door rather than a new one.
 */
export function unplugProvider(provider: MockEmberProvider): number {
  const clients = (
    provider as unknown as {
      server?: { _clients?: Iterable<{ socket?: { destroy(): void } }> };
    }
  ).server?._clients;
  let dropped = 0;
  for (const client of clients ?? []) {
    client.socket?.destroy();
    dropped += 1;
  }
  provider.close();
  return dropped;
}

/**
 * Discards the transport of every connected socket. The client sees `transport close` and dials
 * again by itself, which is what a machine going down looks like from the browser. Calling
 * `socket.disconnect()` instead would send `io server disconnect`, and the client would never
 * come back.
 */
export function closeTransports(server: StartedServer): number {
  const sockets = server.io.of('/').sockets;
  const count = sockets.size;
  for (const socket of sockets.values()) {
    socket.conn.close(true);
  }
  return count;
}

/** The next snapshot that satisfies `match`, ignoring the ones that do not. */
export function nextSnapshotWhere(
  socket: Socket,
  match: (snapshot: MixerSnapshot) => boolean,
): Promise<MixerSnapshot> {
  return new Promise((resolve) => {
    const listener = (snapshot: MixerSnapshot): void => {
      if (match(snapshot)) {
        socket.off(SOCKET_EVENTS.MIXER_SNAPSHOT, listener);
        resolve(snapshot);
      }
    };
    socket.on(SOCKET_EVENTS.MIXER_SNAPSHOT, listener);
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createStackHarness(): StackHarness {
  const providers: MockEmberProvider[] = [];
  const servers: StartedServer[] = [];
  const sockets: Socket[] = [];

  const connectClient = async (
    url: string,
    clientOptions: ClientOptions = {},
  ): Promise<{ socket: Socket; snapshot: MixerSnapshot }> => {
    const socket = io(url, { transports: ['websocket'], autoConnect: false, ...clientOptions });
    sockets.push(socket);
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const snapshot = waitFor<MixerSnapshot>(socket, SOCKET_EVENTS.MIXER_SNAPSHOT);
    socket.connect();
    await connected;
    return { socket, snapshot: await snapshot };
  };

  const startServer = async ({
    httpPort,
    configDir,
    extra = {},
  }: {
    httpPort: number;
    configDir: string;
    extra?: StartStackOptions;
  }): Promise<StartedServer> => {
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      configDir,
      silent: true,
      emberSeed: null,
      timeoutMs: extra.timeoutMs ?? 3000,
      disconnectTimeoutMs: 500,
      reconnectInitialMs: 50,
      reconnectMaxMs: 100,
      treeRefreshDebounceMs: 20,
      incompleteStripRetryMs: extra.incompleteStripRetryMs,
      busDirectoryPollMs: extra.busDirectoryPollMs ?? 0,
    });
    servers.push(server);
    return server;
  };

  const startStack = async (
    dump: DumpTree = createRequiredDump(),
    extra: StartStackOptions = {},
  ): Promise<Stack> => {
    const provider = MockEmberProvider.fromDump(dump, {
      ...(extra.providerPort === undefined ? {} : { port: extra.providerPort }),
      ...extra.providerOptions,
    });
    providers.push(provider);
    const { host, port } = await provider.listen();
    const configDir = await mkdtemp(path.join(tmpdir(), 'flwc-int-'));
    await writeConfig(configDir, host, port);
    const httpPort = extra.httpPort ?? (await findFreePort('127.0.0.1'));
    const server = await startServer({ httpPort, configDir, extra });
    const url = `http://127.0.0.1:${httpPort}`;
    const { socket, snapshot } = await connectClient(url, extra.clientOptions);
    return { server, provider, socket, url, httpPort, configDir, snapshot };
  };

  const cleanup = async (): Promise<void> => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    // `allSettled`, not `all`: the restart case closes a server on purpose mid-test, and closing an
    // already-closed instance must not abandon the teardown of the ones behind it.
    await Promise.allSettled(servers.splice(0).map((server) => server.app.close()));
    for (const provider of providers.splice(0)) {
      provider.close();
    }
  };

  return { providers, servers, sockets, startStack, startServer, connectClient, cleanup };
}
