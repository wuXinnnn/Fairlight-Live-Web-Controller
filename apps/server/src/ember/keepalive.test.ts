import { createServer, type Server, type Socket } from 'node:net';
import { createRequiredDump, findFreePort, MockEmberProvider } from '@flwc/test-utils';
import { EmberClient } from 'emberplus-connection';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const KEEPALIVE_INTERVAL_MS = 10_000;
const KEEPALIVE_RESPONSE_WINDOW_MS = 500;

type IntervalCallback = () => void;
type SetIntervalSpy = MockInstance<typeof globalThis.setInterval>;

/**
 * Guards the library-managed S101 keepalive that keeps an idle Ember+ session open. The values
 * are hard-coded inside emberplus-connection, so this suite fails loudly if an upgrade changes
 * or drops the behaviour the reconnect logic in EmberService depends on.
 */
describe('Ember+ keepalive', () => {
  const clients: EmberClient[] = [];
  const providers: MockEmberProvider[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const client of clients.splice(0)) {
      client.discard();
    }
    for (const provider of providers.splice(0)) {
      provider.close();
    }
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  function findKeepaliveCallback(spy: SetIntervalSpy): IntervalCallback {
    const call = spy.mock.calls.find((args) => args[1] === KEEPALIVE_INTERVAL_MS);
    if (call === undefined) {
      throw new Error('keepalive interval was not armed');
    }
    return call[0] as IntervalCallback;
  }

  async function connectClient(host: string, port: number) {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const client = new EmberClient(host, port, 1_000);
    clients.push(client);
    const disconnected = vi.fn();
    client.on('disconnected', disconnected);
    await client.connect();
    return { client, disconnected, setIntervalSpy };
  }

  it('arms a 10 s keepalive after connecting and stays connected when the provider answers', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    providers.push(provider);
    const { host, port } = await provider.listen();
    const { disconnected, setIntervalSpy } = await connectClient(host, port);

    const sendKeepalive = findKeepaliveCallback(setIntervalSpy);
    sendKeepalive();
    await new Promise((resolve) => setTimeout(resolve, KEEPALIVE_RESPONSE_WINDOW_MS + 200));
    expect(disconnected).not.toHaveBeenCalled();
  });

  it('drops the socket when a keepalive response is missing', async () => {
    const host = '127.0.0.1';
    const port = await findFreePort(host);
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      // Accept the TCP connection but never answer any S101 frame.
      sockets.push(socket);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, host, resolve));

    const { disconnected, setIntervalSpy } = await connectClient(host, port);
    const sendKeepalive = findKeepaliveCallback(setIntervalSpy);
    sendKeepalive();
    await expect.poll(() => disconnected.mock.calls.length, { timeout: 2_000 }).toBeGreaterThan(0);
    for (const socket of sockets) {
      socket.destroy();
    }
  });
});
