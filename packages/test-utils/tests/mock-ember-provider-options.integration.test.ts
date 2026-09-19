import { connect, type Socket } from 'node:net';
import { EmberClient } from 'emberplus-connection';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequiredDump } from '../src/fixtures.js';
import { MockEmberProvider, type MockEmberProviderOptions } from '../src/mock-ember-provider.js';

/**
 * The two knobs that make the mock behave like Fairlight Live's Ember+ provider under load: it
 * admits one connection at a time, and it never closes its side of a session the client has
 * half-closed. Both are off unless asked for, and the default path must stay exactly as it was.
 */
describe('MockEmberProvider connection options', () => {
  const providers: MockEmberProvider[] = [];
  const sockets: Socket[] = [];
  const clients: EmberClient[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.discard();
    }
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    for (const provider of providers.splice(0)) {
      provider.close();
    }
  });

  async function listen(
    options: MockEmberProviderOptions = {},
  ): Promise<{ provider: MockEmberProvider; port: number }> {
    const provider = MockEmberProvider.fromDump(createRequiredDump(), options);
    providers.push(provider);
    const { port } = await provider.listen();
    return { provider, port };
  }

  function dial(port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  function endOf(socket: Socket): Promise<'end'> {
    return new Promise((resolve) => {
      socket.once('end', () => resolve('end'));
    });
  }

  function closeOf(socket: Socket): Promise<'close'> {
    return new Promise((resolve) => {
      socket.once('close', () => resolve('close'));
    });
  }

  function after<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(value), ms);
    });
  }

  it('answers a half-close with its own by default and holds nothing', async () => {
    const { provider, port } = await listen();
    const socket = await dial(port);
    await expect.poll(() => provider.acceptedCount).toBe(1);
    const ended = endOf(socket);
    socket.end();
    // Node closes back on the client's FIN when nothing asks it not to.
    await expect(ended).resolves.toBe('end');
    expect(provider.halfClosedCount).toBe(0);
  });

  it('keeps a half-closed session open when told to, until a reset or close', async () => {
    const { provider, port } = await listen({ holdHalfClosed: true });
    const polite = await dial(port);
    const abrupt = await dial(port);
    await expect.poll(() => provider.acceptedCount).toBe(2);

    const politeEnded = endOf(polite);
    polite.end();
    await expect.poll(() => provider.halfClosedCount).toBe(1);
    // The provider's side stays open: the client sees no FIN come back.
    await expect(Promise.race([politeEnded, after(200, 'still open')])).resolves.toBe('still open');

    // A reset is not a half-close; the session goes away without ever being counted.
    abrupt.resetAndDestroy();
    await after(100, undefined);
    expect(provider.halfClosedCount).toBe(1);

    // Closing the provider destroys what it was holding; the client sees a reset, not a FIN.
    const politeClosed = closeOf(polite);
    provider.close();
    await expect(politeClosed).resolves.toBe('close');
    expect(provider.halfClosedCount).toBe(0);
  });

  it('admits every connection at once by default', async () => {
    const { provider, port } = await listen();
    await Promise.all([dial(port), dial(port), dial(port)]);
    await expect.poll(() => provider.acceptedCount).toBe(3);
  });

  it('admits queued connections one at a time and skips one that gave up waiting', async () => {
    const intervalMs = 150;
    const { provider, port } = await listen({ acceptIntervalMs: intervalMs });
    const started = performance.now();
    const [, , third] = await Promise.all([dial(port), dial(port), dial(port), dial(port)]);
    // The first one goes straight through; the rest wait their turn behind the gate.
    await expect.poll(() => provider.acceptedCount).toBe(1);
    third.destroy();
    await expect.poll(() => provider.acceptedCount, { timeout: 2_000 }).toBe(3);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(intervalMs * 2);
    // Three admitted out of four dialled: the one destroyed while queued never became a session.
    await after(intervalMs * 2, undefined);
    expect(provider.acceptedCount).toBe(3);
  });

  it('loses no Ember bytes across the wait: a queued client still expands the whole tree', async () => {
    const { provider, port } = await listen({ acceptIntervalMs: 200 });
    const first = new EmberClient('127.0.0.1', port, 3000);
    const second = new EmberClient('127.0.0.1', port, 3000);
    clients.push(first, second);
    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([first.expand(first.tree), second.expand(second.tree)]);
    for (const client of [first, second]) {
      const level = await client.getElementByPath('channel.channel1.level');
      expect(level?.contents).toMatchObject({ identifier: 'level', value: -6 });
    }
    expect(provider.acceptedCount).toBe(2);
  });
});
