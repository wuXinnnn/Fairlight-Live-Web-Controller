import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { EmberProtocolError } from './errors.js';
import { EmberService } from './ember-service.js';
import { FakeEmberClient } from './fake-ember-client.js';
import { parameterNode } from './tree-helpers.js';
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
    await service.invoke({ contents: { identifier: 'reset' } } as EmberFunctionNode);
    await service.refreshTree();
    expect(service.tree).toBe(client.tree);
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
