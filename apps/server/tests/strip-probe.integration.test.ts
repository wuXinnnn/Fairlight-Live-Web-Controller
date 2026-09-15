import { createRequiredDump } from '@flwc/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createStackHarness, delay } from './mixer-stack.js';

/**
 * How often the strip probe runs in these cases. Production polls every two seconds; a tenth of
 * that gets through the same number of probes in a tenth of the time.
 */
const PROBE_INTERVAL_MS = 200;

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

describe('mixer strip probe', { timeout: 20_000 }, () => {
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
