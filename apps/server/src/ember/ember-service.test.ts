import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { EmberProtocolError } from './errors.js';
import { EmberService } from './ember-service.js';
import { FakeEmberClient } from './fake-ember-client.js';
import { emberNode, parameterNode, requiredTree, stripNode } from './tree-helpers.js';
import type { EmberCollection, EmberFunctionNode, EmberParameterNode } from './types.js';
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
      createClient: () => {
        created += 1;
        return created === 1 ? failing : ok;
      },
    });
    services.push(service);
    await service.start();
    expect(service.status).toBe('connecting');
    await expect.poll(() => service.status).toBe('connected');
    expect(created).toBeGreaterThan(1);
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
    await expect.poll(() => service.status).toBe('connected');
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

  it('retries tree expand once when a new strip is missing parameters', async () => {
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
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(trees).toHaveLength(3);
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
    await expect.poll(() => primary.tree[1]?.children?.[2]?.contents).toMatchObject({
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
    await expect.poll(() => primary.tree[1]?.children?.[2]?.contents).toMatchObject({
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
});
