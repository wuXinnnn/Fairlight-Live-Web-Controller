import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { PROBE_SETTLE_MS } from '../tools/expand-ember-tree.js';
import { EmberProtocolError } from './errors.js';
import {
  connectFailureReason,
  DEFAULT_BUS_DIRECTORY_POLL_MS,
  EmberService,
  describeConnectFailure,
  INCOMPLETE_STRIP_RETRY_SCHEDULE_MS,
  PROBE_MIN_GAP_MS,
  RECONNECT_JITTER_RATIO,
  type ProbeReason,
} from './ember-service.js';
import { FakeEmberClient, FakeEmberTransport } from './fake-ember-client.js';
import { emberNode, parameterNode, requiredTree, stripNode } from './tree-helpers.js';
import type {
  EmberCollection,
  EmberFunctionNode,
  EmberParameterNode,
  EmberTreeNode,
} from './types.js';
import { Model } from 'emberplus-connection';

describe('EmberService', () => {
  const services: EmberService[] = [];

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.stop()));
  });

  function createService(
    client: FakeEmberClient,
    extra: Partial<ConstructorParameters<typeof EmberService>[0]> = {},
  ): EmberService {
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 30,
      reconnectInitialMs: 20,
      reconnectMaxMs: 40,
      treeRefreshDebounceMs: 10,
      busDirectoryPollMs: 0,
      createClient: () => client,
      ...extra,
    });
    services.push(service);
    return service;
  }

  it('connects, expands the tree, and emits connected status', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    const statuses: string[] = [];
    const trees: EmberCollection[] = [];
    service.on('status', (status) => statuses.push(status));
    service.on('tree', (tree) => trees.push(tree));
    await service.start();
    expect(service.status).toBe('connected');
    expect(client.connected).toBe(true);
    expect(client.expandCalls).toBeGreaterThan(0);
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(trees).toHaveLength(1);
    expect(service.endpoint).toEqual({ host: '127.0.0.1', port: 1 });
  });

  it('reconnects after a failed attempt using backoff', async () => {
    let created = 0;
    const failing = new FakeEmberClient();
    failing.failConnect = new Error('refused');
    const ok = new FakeEmberClient();
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 20,
      reconnectInitialMs: 15,
      reconnectMaxMs: 15,
      busDirectoryPollMs: 0,
      // A fixed jitter source keeps the delay at exactly the backoff.
      random: () => 0.5,
      createClient: () => {
        created += 1;
        return created === 1 ? failing : ok;
      },
    });
    services.push(service);
    const statuses: Array<[string, string | undefined]> = [];
    service.on('status', (status: string, lastError?: string) => {
      statuses.push([status, lastError]);
    });
    await service.start();
    expect(service.status).toBe('connecting');
    expect(service.lastError).toBe('refused');
    expect(statuses).toEqual([
      ['connecting', undefined],
      ['connecting', 'refused'],
    ]);
    await expect.poll(() => service.status).toBe('connected');
    expect(service.lastError).toBeUndefined();
    expect(statuses.at(-1)).toEqual(['connected', undefined]);
    expect(created).toBeGreaterThan(1);
  });

  it('ignores the outcome of a dialling attempt that a reconfigure replaced', async () => {
    const slowFailure = new FakeEmberClient();
    slowFailure.connectDelayMs = 60;
    slowFailure.failConnect = new Error('Could not connect to 127.0.0.1:1 after a timeout');
    const ok = new FakeEmberClient();
    let created = 0;
    const service = createService(slowFailure, {
      timeoutMs: 500,
      reconnectInitialMs: 10_000,
      reconnectMaxMs: 10_000,
      createClient: () => {
        created += 1;
        return created === 1 ? slowFailure : ok;
      },
    });
    const statuses: Array<[string, string | undefined]> = [];
    service.on('status', (status: string, lastError?: string) => {
      statuses.push([status, lastError]);
    });
    const starting = service.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.status).toBe('connecting');
    await service.configure('127.0.0.1', 2);
    expect(service.status).toBe('connected');
    statuses.length = 0;

    await starting;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(service.status).toBe('connected');
    expect(service.lastError).toBeUndefined();
    expect(statuses).toEqual([]);
    expect(ok.connected).toBe(true);
  });

  it('retires a client that never connected without waiting for its disconnect', async () => {
    const dialling = new FakeEmberClient();
    dialling.connectDelayMs = 300;
    dialling.failConnect = new Error('Could not connect to 127.0.0.1:1 after a timeout');
    dialling.hangDisconnect = true;
    const ok = new FakeEmberClient();
    let created = 0;
    const service = createService(dialling, {
      timeoutMs: 5_000,
      disconnectTimeoutMs: 1_000,
      reconnectInitialMs: 10_000,
      reconnectMaxMs: 10_000,
      createClient: () => {
        created += 1;
        return created === 1 ? dialling : ok;
      },
    });
    const starting = service.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.status).toBe('connecting');
    const began = performance.now();
    await service.configure('127.0.0.1', 2);
    // A dialling client has nothing to disconnect; the switch must not wait for the timeout.
    expect(performance.now() - began).toBeLessThan(500);
    expect(service.status).toBe('connected');
    expect(dialling.discarded).toBe(true);
    expect(ok.connected).toBe(true);
    await starting;
  });

  it('keeps the last error while retrying and clears it when reconfigured', async () => {
    const failing = new FakeEmberClient();
    failing.failConnect = new Error('connect ECONNREFUSED 127.0.0.1:1');
    const service = createService(failing, { reconnectInitialMs: 10_000, reconnectMaxMs: 10_000 });
    const statuses: Array<[string, string | undefined]> = [];
    service.on('status', (status: string, lastError?: string) => {
      statuses.push([status, lastError]);
    });
    await service.start();
    expect(service.lastError).toBe('connect ECONNREFUSED 127.0.0.1:1');

    failing.failConnect = new Error('connect ECONNREFUSED 10.0.0.8:9000');
    statuses.length = 0;
    await service.configure('10.0.0.8', 9000);
    // The stale reason is cleared before the new endpoint dials, then the new failure lands.
    expect(statuses).toEqual([
      ['connecting', undefined],
      ['connecting', 'connect ECONNREFUSED 10.0.0.8:9000'],
    ]);
    expect(service.lastError).toBe('connect ECONNREFUSED 10.0.0.8:9000');
    await service.stop();
    expect(service.lastError).toBeUndefined();
  });

  it('discards the client when disconnect hangs', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    await service.start();
    client.hangDisconnect = true;
    await service.stop();
    expect(client.discarded).toBe(true);
    expect(service.status).toBe('disconnected');
  });

  it('times out a hung connect and schedules reconnect', async () => {
    const hanging = new FakeEmberClient();
    hanging.hangConnect = true;
    const ok = new FakeEmberClient();
    let created = 0;
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 20,
      disconnectTimeoutMs: 20,
      reconnectInitialMs: 10,
      reconnectMaxMs: 10,
      busDirectoryPollMs: 0,
      createClient: () => {
        created += 1;
        return created === 1 ? hanging : ok;
      },
    });
    services.push(service);
    await service.start();
    // No socket error arrived, so the dial simply got no answer; the panel says as much.
    expect(service.lastError).toBe(
      'Timeout after 20ms: connect (no answer from 127.0.0.1:1; the provider may be busy)',
    );
    await expect.poll(() => service.status).toBe('connected');
    expect(service.lastError).toBeUndefined();
  });

  it('reports the socket error behind a dial the library kept quiet about', async () => {
    const refused = new FakeEmberClient();
    refused.transport = new FakeEmberTransport();
    refused.socketError = new Error('connect ECONNREFUSED 127.0.0.1:1');
    // The library swallows ECONNREFUSED and keeps dialling, so all the service sees is a timeout.
    refused.hangConnect = true;
    const errors: Array<Record<string, unknown>> = [];
    const logger: AppLogger = {
      ...silentLogger(),
      error: (obj) => errors.push(obj as Record<string, unknown>),
    };
    const service = createService(refused, {
      logger,
      timeoutMs: 20,
      reconnectInitialMs: 10_000,
      reconnectMaxMs: 10_000,
    });
    await service.start();
    expect(service.lastError).toBe('connect ECONNREFUSED 127.0.0.1:1');
    expect(errors.at(-1)).toMatchObject({ err: 'connect ECONNREFUSED 127.0.0.1:1' });
  });

  it('turns the library timeout wording into the no-answer reason', async () => {
    const silent = new FakeEmberClient();
    silent.transport = new FakeEmberTransport();
    silent.failConnect = new Error('Could not connect to 127.0.0.1:1 after a timeout of 5 seconds');
    const service = createService(silent, { reconnectInitialMs: 10_000, reconnectMaxMs: 10_000 });
    await service.start();
    expect(service.lastError).toBe(
      'Timeout after 40ms: connect (no answer from 127.0.0.1:1; the provider may be busy)',
    );
  });

  it('treats a session whose tree never arrives as a dial that got no answer', async () => {
    const mute = new FakeEmberClient({});
    const service = createService(mute, { reconnectInitialMs: 10, reconnectMaxMs: 10 });
    await service.start();
    expect(service.status).toBe('connecting');
    expect(service.lastError).toBe(
      'Timeout after 40ms: connect (no answer from 127.0.0.1:1; the provider may be busy)',
    );
    // Once the desk answers, the retry connects like any other.
    mute.tree = requiredTree();
    await expect.poll(() => service.status).toBe('connected');
    expect(service.lastError).toBeUndefined();
  });

  it('spreads reconnect delays by up to 30% either way of the backoff', async () => {
    vi.useFakeTimers();
    try {
      expect(RECONNECT_JITTER_RATIO).toBe(0.3);
      for (const [random, factor] of [
        [0, 0.7],
        [1, 1.3],
        [0.5, 1],
      ] as const) {
        const failing = new FakeEmberClient();
        failing.failConnect = new Error('refused');
        let created = 0;
        const service = createService(failing, {
          reconnectInitialMs: 1_000,
          reconnectMaxMs: 1_000,
          random: () => random,
          createClient: () => {
            created += 1;
            return failing;
          },
        });
        await service.start();
        expect(created).toBe(1);
        const delayMs = Math.round(1_000 * factor);
        await vi.advanceTimersByTimeAsync(delayMs - 1);
        expect(created, `random ${random}`).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(created, `random ${random}`).toBe(2);
        await service.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes concurrent writes', async () => {
    const client = new FakeEmberClient();
    client.setValueDelayMs = 15;
    const service = createService(client);
    await service.start();
    const node = parameterNode(1, 'level', Model.ParameterType.Real, -6);
    if (node.contents.type !== Model.ElementType.Parameter) {
      throw new Error('expected parameter');
    }
    await Promise.all([
      service.setValue(node as EmberParameterNode, -1),
      service.setValue(node as EmberParameterNode, -2),
      service.setValue(node as EmberParameterNode, -3),
    ]);
    expect(client.maxConcurrentSetValue).toBe(1);
    expect(client.setValueCalls).toEqual([-1, -2, -3]);
  });

  it('rejects writes when disconnected', async () => {
    const service = createService(new FakeEmberClient());
    const node = parameterNode(1, 'level', Model.ParameterType.Real, -6);
    await expect(service.setValue(node as EmberParameterNode, 0)).rejects.toBeInstanceOf(
      EmberProtocolError,
    );
  });

  it('treats a provider disconnect as a reconnect signal', async () => {
    const first = new FakeEmberClient();
    const second = new FakeEmberClient();
    let created = 0;
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 20,
      reconnectInitialMs: 10,
      reconnectMaxMs: 10,
      busDirectoryPollMs: 0,
      createClient: () => {
        created += 1;
        return created === 1 ? first : second;
      },
    });
    services.push(service);
    await service.start();
    first.emit('disconnected');
    await expect.poll(() => service.status).toBe('connected');
    expect(second.connected).toBe(true);
  });

  it('reconfigures the endpoint and reconnects', async () => {
    const clients: FakeEmberClient[] = [];
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 20,
      reconnectInitialMs: 10,
      reconnectMaxMs: 10,
      busDirectoryPollMs: 0,
      createClient: (host, port) => {
        const client = new FakeEmberClient(undefined, host, port);
        clients.push(client);
        return client;
      },
    });
    services.push(service);
    await service.start();
    await service.configure('10.0.0.8', 9001);
    expect(service.endpoint).toEqual({ host: '10.0.0.8', port: 9001 });
    expect(clients.length).toBeGreaterThan(1);
    expect(service.status).toBe('connected');
  });

  it('subscribes, invokes, and refreshes an expanded tree', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    await service.start();
    const node = parameterNode(1, 'level', Model.ParameterType.Real, -6);
    await service.subscribe(node, () => undefined);
    await service.subscribe(node, () => undefined);
    await service.invoke({ contents: { identifier: 'reset' } } as EmberFunctionNode);
    await service.refreshTree();
    expect(service.tree).toBe(client.tree);
  });

  it('retries subscribe after a protocol failure', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    await service.start();
    const subscribeCallsAfterStart = client.subscribeCalls;
    const node = parameterNode(1, 'level', Model.ParameterType.Real, -6);
    client.failSubscribe = new Error('subscribe denied');
    await expect(service.subscribe(node, () => undefined)).rejects.toThrow('subscribe denied');
    expect(client.subscribeCalls).toBe(subscribeCallsAfterStart + 1);
    client.failSubscribe = undefined;
    await service.subscribe(node, () => undefined);
    expect(client.subscribeCalls).toBe(subscribeCallsAfterStart + 2);
    const listeners = client.directoryListeners.filter((listener) => listener.node === node);
    expect(listeners).toHaveLength(1);
  });

  it('continues structure watches when an earlier node fails', async () => {
    const client = new FakeEmberClient();
    const system = client.tree[0];
    const channel = client.tree[1];
    expect(system).toBeDefined();
    expect(channel).toBeDefined();
    if (system === undefined || channel === undefined) {
      return;
    }
    client.failSubscribeNodes.add(system);
    const service = createService(client);
    await service.start();
    expect(client.directoryListeners.filter((listener) => listener.node === system)).toHaveLength(
      0,
    );
    expect(
      client.directoryListeners.filter((listener) => listener.node === channel).length,
    ).toBeGreaterThan(0);
  });

  it('retries structure watches after a subscribe failure', async () => {
    const client = new FakeEmberClient();
    client.failSubscribe = new Error('subscribe denied');
    const service = createService(client);
    await service.start();
    const system = client.tree[0];
    expect(system).toBeDefined();
    expect(client.directoryListeners.filter((listener) => listener.node === system)).toHaveLength(
      0,
    );
    client.failSubscribe = undefined;
    await service.refreshTree();
    expect(
      client.directoryListeners.filter((listener) => listener.node === system).length,
    ).toBeGreaterThan(0);
  });

  it('does not emit a stale tree after reconnect during refresh', async () => {
    const first = new FakeEmberClient();
    const second = new FakeEmberClient();
    let created = 0;
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 200,
      disconnectTimeoutMs: 20,
      reconnectInitialMs: 10,
      reconnectMaxMs: 10,
      treeRefreshDebounceMs: 10,
      busDirectoryPollMs: 0,
      createClient: () => {
        created += 1;
        return created === 1 ? first : second;
      },
    });
    services.push(service);
    const trees: EmberCollection[] = [];
    service.on('tree', (tree) => trees.push(tree));
    await service.start();
    expect(trees).toEqual([first.tree]);
    first.getDirectoryDelayMs = 80;
    const refresh = service.refreshTree();
    first.emit('disconnected');
    await expect.poll(() => service.status).toBe('connected');
    await refresh;
    expect(trees.filter((tree) => tree === first.tree)).toHaveLength(1);
    expect(trees.at(-1)).toBe(second.tree);
  });

  it('ignores directory updates after stop', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    const trees: EmberCollection[] = [];
    service.on('tree', (tree) => trees.push(tree));
    await service.start();
    await service.stop();
    const count = trees.length;
    const channelRoot = client.tree[1];
    if (channelRoot !== undefined) {
      client.emitNodeUpdate(channelRoot);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    expect(trees).toHaveLength(count);
  });

  it('retries tree expand after the first delay when a new strip is missing parameters', async () => {
    const client = new FakeEmberClient();
    const service = createService(client, { incompleteStripRetryMs: 20 });
    const trees: EmberCollection[] = [];
    service.on('tree', (tree) => trees.push(tree));
    await service.start();
    expect(trees).toHaveLength(1);
    const channelRoot = client.tree[1];
    expect(channelRoot?.children).toBeDefined();
    if (channelRoot?.children === undefined) {
      return;
    }
    channelRoot.children[2] = emberNode(2, new Model.EmberNodeImpl('channel2', 'PC'), {});
    client.emitNodeUpdate(channelRoot);
    await expect.poll(() => trees.length).toBe(3);
    // The second attempt is a full second away on the schedule, so nothing more lands in 50 ms.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(trees).toHaveLength(3);
  });

  it('backs off retries for an incomplete strip until it fills in, and starts over after a reconnect', async () => {
    vi.useFakeTimers();
    try {
      expect(INCOMPLETE_STRIP_RETRY_SCHEDULE_MS).toEqual([300, 1_000, 3_000, 10_000, 30_000]);
      const client = new FakeEmberClient();
      const service = createService(client, { reconnectInitialMs: 10, reconnectMaxMs: 10 });
      // Every refresh publishes the tree once, so the count of trees is the count of refreshes.
      let refreshes = 0;
      service.on('tree', () => {
        refreshes += 1;
      });
      await service.start();
      const channelRoot = client.tree[1];
      if (channelRoot?.children === undefined) {
        return;
      }
      const stub = emberNode(2, new Model.EmberNodeImpl('channel2', 'PC'), {});
      channelRoot.children[2] = stub;
      client.emitNodeUpdate(channelRoot);
      await vi.advanceTimersByTimeAsync(20);
      const baseline = refreshes;

      // Each step waits until just short of the next delay (the refresh debounce puts the clock
      // a few ms ahead of the schedule), checks nothing ran, then crosses the delay.
      for (const delayMs of [300, 1_000, 3_000, 10_000, 30_000, 30_000]) {
        const before = refreshes;
        await vi.advanceTimersByTimeAsync(delayMs - 100);
        expect(refreshes, `no retry before ${delayMs} ms`).toBe(before);
        await vi.advanceTimersByTimeAsync(110);
        expect(refreshes, `retry after ${delayMs} ms`).toBe(before + 1);
      }
      expect(refreshes).toBe(baseline + 6);

      // A second strip appears: it starts at the front of the schedule, the first one does not.
      channelRoot.children[3] = emberNode(3, new Model.EmberNodeImpl('channel3', 'MUSIC'), {});
      client.emitNodeUpdate(channelRoot);
      await vi.advanceTimersByTimeAsync(20);
      const beforeNewcomer = refreshes;
      await vi.advanceTimersByTimeAsync(300);
      expect(refreshes).toBe(beforeNewcomer + 1);

      // Once the strips fill in, the retries stop.
      const params = (name: string): { [index: number]: EmberTreeNode } => ({
        1: parameterNode(1, 'level', Model.ParameterType.Real, 0),
        2: parameterNode(2, 'mute', Model.ParameterType.Boolean, false),
        3: parameterNode(3, 'name', Model.ParameterType.String, name),
      });
      stub.children = params('PC');
      const other = channelRoot.children[3];
      if (other !== undefined) {
        other.children = params('MUSIC');
      }
      await vi.advanceTimersByTimeAsync(1_000);
      const settled = refreshes;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(refreshes).toBe(settled);

      // After a reconnect the count is gone: an incomplete strip is retried after 300 ms again.
      stub.children = {};
      client.emit('disconnected');
      await vi.advanceTimersByTimeAsync(50);
      expect(service.status).toBe('connected');
      const afterReconnect = refreshes;
      await vi.advanceTimersByTimeAsync(300);
      expect(refreshes).toBe(afterReconnect + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-emits the tree when a watched bus node is updated', async () => {
    const client = new FakeEmberClient();
    const service = createService(client);
    const trees: EmberCollection[] = [];
    service.on('tree', (tree) => trees.push(tree));
    await service.start();
    expect(trees).toHaveLength(1);
    const channelRoot = client.tree[1];
    expect(channelRoot).toBeDefined();
    if (channelRoot === undefined) {
      return;
    }
    if (channelRoot.children !== undefined) {
      channelRoot.children[2] = stripNode('channel', 2, 'PC');
    }
    client.emitNodeUpdate(channelRoot);
    await expect.poll(() => trees.length).toBeGreaterThan(1);
    expect(client.tree[1]?.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
  });

  it('probes for mixer strips that never arrived on the live tree', async () => {
    const primary = new FakeEmberClient();
    const probeTree = requiredTree();
    const channelRoot = probeTree[1];
    if (channelRoot?.children !== undefined) {
      channelRoot.children[2] = stripNode('channel', 2, 'PC');
    }
    const probe = new FakeEmberClient(probeTree);
    let created = 0;
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 30,
      treeRefreshDebounceMs: 10,
      busDirectoryPollMs: 20,
      createClient: () => {
        created += 1;
        return created === 1 ? primary : probe;
      },
    });
    services.push(service);
    await service.start();
    await expect
      .poll(() => primary.tree[1]?.children?.[2]?.contents)
      .toMatchObject({
        identifier: 'channel2',
      });
  });

  it('reclaims a ghost occupant when the probe finds a new strip', async () => {
    const primary = new FakeEmberClient();
    const primaryChannel = primary.tree[1];
    if (primaryChannel?.children !== undefined) {
      primaryChannel.children[2] = emberNode(2, new Model.EmberNodeImpl(), {});
    }
    const probeTree = requiredTree();
    const probeChannel = probeTree[1];
    if (probeChannel?.children !== undefined) {
      probeChannel.children[2] = stripNode('channel', 2, 'PC');
    }
    const probe = new FakeEmberClient(probeTree);
    let created = 0;
    const service = new EmberService({
      host: '127.0.0.1',
      port: 1,
      logger: silentLogger(),
      timeoutMs: 40,
      disconnectTimeoutMs: 30,
      treeRefreshDebounceMs: 10,
      busDirectoryPollMs: 20,
      createClient: () => {
        created += 1;
        return created === 1 ? primary : probe;
      },
    });
    services.push(service);
    await service.start();
    await expect
      .poll(() => primary.tree[1]?.children?.[2]?.contents)
      .toMatchObject({
        identifier: 'channel2',
      });
  });

  it('resolves invoke after send when the provider never returns a result', async () => {
    const client = new FakeEmberClient();
    client.hangInvokeResponse = true;
    const service = createService(client);
    await service.start();
    await expect(
      service.invoke({ contents: { identifier: 'reset' } } as EmberFunctionNode),
    ).resolves.toBeUndefined();
    expect(client.invokeCalls).toBe(1);
  });

  it('rejects invoke when the command is not sent', async () => {
    const client = new FakeEmberClient();
    client.failInvokeSend = true;
    const service = createService(client);
    await service.start();
    await expect(
      service.invoke({ contents: { identifier: 'reset' } } as EmberFunctionNode),
    ).rejects.toBeInstanceOf(EmberProtocolError);
  });

  it('does not start twice and logs expand errors without failing', async () => {
    const client = new FakeEmberClient();
    client.getDirectory = async () => {
      throw new Error('sends hung');
    };
    const service = createService(client);
    await service.start();
    await service.start();
    expect(service.status).toBe('connected');
  });

  describe('mixer strip probe scheduling', () => {
    interface ProbeHarness {
      service: EmberService;
      primary: FakeEmberClient;
      probes: FakeEmberClient[];
      reasons: () => ProbeReason[][];
      warnings: Array<Record<string, unknown>>;
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * The first client the service asks for is the live one; every later one is a probe, built
     * from a fresh copy of the required tree unless the case supplies its own.
     */
    function probeHarness(
      extra: Partial<ConstructorParameters<typeof EmberService>[0]> = {},
      makeProbe: () => FakeEmberClient = () => new FakeEmberClient(requiredTree()),
    ): ProbeHarness {
      const primary = new FakeEmberClient();
      const probes: FakeEmberClient[] = [];
      const debug: Array<Record<string, unknown>> = [];
      const warnings: Array<Record<string, unknown>> = [];
      const logger: AppLogger = {
        ...silentLogger(),
        debug: (obj) => debug.push(obj as Record<string, unknown>),
        warn: (obj) => warnings.push(obj as Record<string, unknown>),
      };
      let created = 0;
      const service = new EmberService({
        host: '127.0.0.1',
        port: 1,
        logger,
        timeoutMs: 40,
        disconnectTimeoutMs: 30,
        treeRefreshDebounceMs: 10,
        createClient: () => {
          created += 1;
          if (created === 1) {
            return primary;
          }
          const probe = makeProbe();
          probes.push(probe);
          return probe;
        },
        ...extra,
      });
      services.push(service);
      const reasons = (): ProbeReason[][] =>
        debug
          .filter((entry) => Array.isArray(entry.reasons))
          .map((entry) => entry.reasons as ProbeReason[]);
      return { service, primary, probes, reasons, warnings };
    }

    /** Lets a probe that has started run to its end: the settle wait is the only timer in it. */
    async function finishProbe(): Promise<void> {
      await vi.advanceTimersByTimeAsync(PROBE_SETTLE_MS + 1);
    }

    it('probes once on connect and then every 60 s by default, timed from the last probe', async () => {
      expect(DEFAULT_BUS_DIRECTORY_POLL_MS).toBe(60_000);
      const { service, probes, reasons } = probeHarness();
      await service.start();
      await finishProbe();
      expect(probes).toHaveLength(1);
      expect(reasons()).toEqual([['connect']]);

      await vi.advanceTimersByTimeAsync(DEFAULT_BUS_DIRECTORY_POLL_MS - 1_000);
      expect(probes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await finishProbe();
      expect(probes).toHaveLength(2);
      expect(reasons()).toEqual([['connect'], ['periodic']]);

      // The next period starts when the last probe finished, not on a fixed grid.
      await vi.advanceTimersByTimeAsync(DEFAULT_BUS_DIRECTORY_POLL_MS - 10);
      expect(probes).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(PROBE_SETTLE_MS + 20);
      await finishProbe();
      expect(probes).toHaveLength(3);
    });

    it('folds triggers into one probe and keeps 5 s between probes', async () => {
      expect(PROBE_MIN_GAP_MS).toBe(5_000);
      const { service, primary, probes, reasons } = probeHarness();
      await service.start();
      await finishProbe();
      expect(probes).toHaveLength(1);

      const channelRoot = primary.tree[1];
      expect(channelRoot?.children).toBeDefined();
      if (channelRoot?.children === undefined) {
        return;
      }
      // A ghost the desk pushed without an identifier: found on the next tree refresh.
      channelRoot.children[7] = emberNode(7, new Model.EmberNodeImpl(), {});
      primary.emitNodeUpdate(channelRoot);
      await vi.advanceTimersByTimeAsync(50);
      // A numbered directory update that brought a new child: reported by the merge patch.
      primary._updateTree(
        emberNode(1, new Model.EmberNodeImpl('channel'), { 8: stripNode('channel', 8, 'PC') }),
        channelRoot,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      // Both asked within a second of the connect probe; neither gets its own run yet.
      expect(probes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(PROBE_MIN_GAP_MS);
      await finishProbe();
      expect(probes).toHaveLength(2);
      expect([...(reasons()[1] ?? [])].sort()).toEqual(['children-added', 'ghost']);
    });

    it('asks for a probe when a strip is still incomplete after a refresh', async () => {
      const { service, primary, probes, reasons } = probeHarness();
      await service.start();
      await finishProbe();
      const channelRoot = primary.tree[1];
      if (channelRoot?.children === undefined) {
        return;
      }
      channelRoot.children[2] = emberNode(2, new Model.EmberNodeImpl('channel2', 'PC'), {});
      primary.emitNodeUpdate(channelRoot);
      await vi.advanceTimersByTimeAsync(PROBE_MIN_GAP_MS + 100);
      await finishProbe();
      expect(probes.length).toBeGreaterThanOrEqual(2);
      expect(reasons()[1]).toContain('incomplete');
    });

    it('ignores every trigger while the probe is switched off', async () => {
      const { service, primary, probes } = probeHarness({ busDirectoryPollMs: 0 });
      await service.start();
      const channelRoot = primary.tree[1];
      if (channelRoot?.children === undefined) {
        return;
      }
      channelRoot.children[7] = emberNode(7, new Model.EmberNodeImpl(), {});
      primary.emitNodeUpdate(channelRoot);
      primary._updateTree(
        emberNode(1, new Model.EmberNodeImpl('channel'), { 8: stripNode('channel', 8, 'PC') }),
        channelRoot,
      );
      await vi.advanceTimersByTimeAsync(2 * DEFAULT_BUS_DIRECTORY_POLL_MS);
      expect(probes).toHaveLength(0);
      expect(service.status).toBe('connected');
    });

    it('closes the probe connection with a reset, never a FIN', async () => {
      const { service, probes } = probeHarness({}, () => {
        const probe = new FakeEmberClient(requiredTree());
        probe.transport = new FakeEmberTransport();
        return probe;
      });
      await service.start();
      const probe = probes[0];
      expect(probe?.transport?.socket).toBeDefined();
      const socket = probe?.transport?.socket;
      await finishProbe();
      expect(socket?.resetCalls).toBe(1);
      expect(socket?.endCalls).toBe(0);
      expect(socket?.destroyCalls).toBe(0);
      expect(probe?.disconnectCalls).toBe(0);
      expect(probe?.discarded).toBe(true);
      // discard() came after the reset, so the library's own hang-up found no socket to FIN.
      expect(probe?.transport).toBeUndefined();
    });

    it('warns when the probe lists fewer strips than the live tree holds', async () => {
      const { service, primary, warnings } = probeHarness();
      const channelRoot = primary.tree[1];
      if (channelRoot?.children !== undefined) {
        channelRoot.children[2] = stripNode('channel', 2, 'PC');
      }
      await service.start();
      await finishProbe();
      const warning = warnings.find((entry) => 'missing' in entry);
      expect(warning).toMatchObject({
        known: 4,
        discovered: 3,
        missing: ['channel/channel2'],
      });
    });

    it('stops the probe timer with the service', async () => {
      const { service, probes } = probeHarness();
      await service.start();
      await finishProbe();
      await service.stop();
      await vi.advanceTimersByTimeAsync(2 * DEFAULT_BUS_DIRECTORY_POLL_MS);
      expect(probes).toHaveLength(1);
    });
  });
});

describe('connectFailureReason', () => {
  it('condenses errors into one short line', () => {
    expect(connectFailureReason(new Error('connect ECONNREFUSED 10.0.0.8:9000'))).toBe(
      'connect ECONNREFUSED 10.0.0.8:9000',
    );
    expect(connectFailureReason(new Error('  multi\n line   message '))).toBe('multi line message');
    expect(connectFailureReason('socket hang up')).toBe('socket hang up');
  });

  it('unwraps aggregate errors and falls back for empty messages', () => {
    expect(
      connectFailureReason(new AggregateError([new Error('first'), new Error('second')], '')),
    ).toBe('first');
    expect(connectFailureReason(new AggregateError([], ''))).toBe('Connection failed');
    expect(connectFailureReason(new Error(''))).toBe('Connection failed');
  });

  it('truncates very long messages', () => {
    const reason = connectFailureReason(new Error('x'.repeat(500)));
    expect(reason).toHaveLength(200);
    expect(reason.endsWith('…')).toBe(true);
  });
});

describe('describeConnectFailure', () => {
  const context = { host: '10.0.0.8', port: 9000, timeoutMs: 5000 };

  it('prefers the socket error over whatever the dial reported', () => {
    expect(
      describeConnectFailure(
        new Error('Timeout after 5000ms: connect'),
        new Error('connect EHOSTUNREACH 10.0.0.8:9000'),
        context,
      ),
    ).toBe('connect EHOSTUNREACH 10.0.0.8:9000');
  });

  it('calls a timeout without a socket error a silent provider', () => {
    const noAnswer =
      'Timeout after 5000ms: connect (no answer from 10.0.0.8:9000; the provider may be busy)';
    expect(
      describeConnectFailure(new Error('Timeout after 5000ms: connect'), undefined, context),
    ).toBe(noAnswer);
    expect(
      describeConnectFailure(
        new Error('Could not connect to 10.0.0.8:9000 after a timeout of 5 seconds'),
        undefined,
        context,
      ),
    ).toBe(noAnswer);
  });

  it('passes any other failure through as it is', () => {
    expect(describeConnectFailure(new Error('subscribe denied'), undefined, context)).toBe(
      'subscribe denied',
    );
  });
});
