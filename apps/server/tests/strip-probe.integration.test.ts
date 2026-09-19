import { createRequiredDump, MockEmberProvider } from '@flwc/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { EmberService } from '../src/ember/ember-service.js';
import { silentLogger } from '../src/logger.js';
import { listMixerStripRefs } from '../src/tools/expand-ember-tree.js';
import { createStackHarness, delay } from './mixer-stack.js';

/**
 * How often the strip probe runs in these cases. Production polls once a minute; this gets
 * through a run of probes in a couple of seconds.
 */
const PROBE_INTERVAL_MS = 200;

/** How a desk that admits one connection every 600 ms and never answers a FIN is played. */
const BUSY_DESK = { acceptIntervalMs: 600, holdHalfClosed: true } as const;

/**
 * Timers this process is holding, which is what a probe leaks.
 *
 * `emberplus-connection` starts a connection-attempt interval per client and `disconnect()` does
 * not clear it, so an abandoned probe keeps a live timer rather than a live socket. The socket
 * count stays flat while this one climbs.
 */
function openTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

describe('mixer strip probe', { timeout: 40_000 }, () => {
  const harness = createStackHarness();
  const { startStack } = harness;

  afterEach(harness.cleanup);

  it('does not leave a socket behind for every probe it runs', async () => {
    const { server } = await startStack(createRequiredDump(), {
      busDirectoryPollMs: PROBE_INTERVAL_MS,
    });

    // Measured after the stack has settled, so the count is probes and nothing else.
    await delay(PROBE_INTERVAL_MS * 3);
    const before = openTimers();

    const rounds = 10;
    await delay(PROBE_INTERVAL_MS * rounds);
    const after = openTimers();

    /*
     * The probe dials the desk, reads the bus directory and hangs up, so a run of them should cost
     * nothing that lasts. `disconnect()` alone does not achieve that, which is why the live client
     * is put through `retireEmberTransport` rather than merely disconnected: that is what clears
     * the connection-attempt interval the library leaves running. A probe that skips it leaks one
     * timer every interval — at the production two second poll, eighteen hundred over an hour, and
     * the soak run that found this watched the server's handle count climb by five every ten
     * seconds for exactly that reason.
     *
     * A couple are allowed for a probe in flight and for the harness's own timers.
     */
    expect(
      after - before,
      `${rounds} probes should not each leave a timer behind`,
    ).toBeLessThanOrEqual(2);
    expect(server.runtime.store.connection).toBe('connected');
  });

  it('leaves no half-closed session behind on a desk that never closes its side', async () => {
    const { server, provider } = await startStack(createRequiredDump(), {
      busDirectoryPollMs: PROBE_INTERVAL_MS,
      providerOptions: { holdHalfClosed: true },
    });
    const sessionsBefore = provider.acceptedCount;
    let worstHalfClosed = 0;
    const samples = 100;
    for (let sample = 0; sample < samples; sample += 1) {
      await delay(20);
      worstHalfClosed = Math.max(worstHalfClosed, provider.halfClosedCount);
    }
    /*
     * A probe that hung up with a FIN would sit in the provider's half-closed set from the moment
     * it left until the provider is closed, so the count is sampled all the way through rather
     * than read once at the end. Fairlight Live keeps such sessions until it is restarted.
     */
    expect(provider.acceptedCount - sessionsBefore, 'probes run').toBeGreaterThanOrEqual(5);
    expect(worstHalfClosed).toBe(0);
    expect(server.runtime.store.connection).toBe('connected');
  });

  it('two backends behind a desk that admits one connection at a time both read every strip', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump(), BUSY_DESK);
    harness.providers.push(provider);
    const { host, port } = await provider.listen();
    const services = [0, 1].map(
      () => new EmberService({ host, port, logger: silentLogger(), treeRefreshDebounceMs: 20 }),
    );
    try {
      await Promise.all(services.map((service) => service.start()));
      await expect
        .poll(() => services.map((service) => service.status), { timeout: 30_000 })
        .toEqual(['connected', 'connected']);
      const expected = listMixerStripRefs(services[0]?.tree ?? {}).length;
      expect(expected).toBe(3);
      for (const service of services) {
        expect(listMixerStripRefs(service.tree ?? {})).toHaveLength(expected);
      }
      expect(provider.halfClosedCount).toBe(0);
    } finally {
      await Promise.all(services.map((service) => service.stop()));
    }
  });

  it('keeps finding the strips it is meant to find while it runs', async () => {
    const { server } = await startStack(createRequiredDump(), {
      busDirectoryPollMs: PROBE_INTERVAL_MS,
    });
    await delay(PROBE_INTERVAL_MS * 5);
    // Whatever the probe does about its sockets, it must not disturb the desk it is probing.
    expect(server.runtime.store.snapshot().channels).toHaveLength(3);
    expect(server.runtime.store.connection).toBe('connected');
  });
});
