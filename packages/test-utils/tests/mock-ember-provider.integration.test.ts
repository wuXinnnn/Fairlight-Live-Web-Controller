import { EmberClient, Model } from 'emberplus-connection';
import { afterEach, describe, expect, it } from 'vitest';
import { dumpNodeToEmber } from '../src/dump-to-ember-tree.js';
import { createRequiredDump } from '../src/fixtures.js';
import { MockEmberProvider } from '../src/mock-ember-provider.js';

describe('MockEmberProvider integration', () => {
  const providers: MockEmberProvider[] = [];
  const clients: EmberClient[] = [];

  afterEach(async () => {
    await Promise.all(
      clients.splice(0).map(async (client) => {
        try {
          await client.disconnect();
        } catch {
          client.discard();
        }
      }),
    );
    for (const provider of providers.splice(0)) {
      provider.close();
    }
  });

  function findNode(
    collection: { [index: number]: Model.NumberedTreeNode<Model.EmberElement> },
    ...identifiers: string[]
  ): Model.NumberedTreeNode<Model.EmberElement> | undefined {
    let current: Model.NumberedTreeNode<Model.EmberElement> | undefined;
    let nodes: Array<Model.NumberedTreeNode<Model.EmberElement>> = Object.values(collection);
    for (const identifier of identifiers) {
      current = nodes.find(
        (node) => 'identifier' in node.contents && node.contents.identifier === identifier,
      );
      if (current === undefined) {
        return undefined;
      }
      nodes = current.children === undefined ? [] : Object.values(current.children);
    }
    return current;
  }

  async function connectTo(provider: MockEmberProvider): Promise<EmberClient> {
    providers.push(provider);
    const { host, port } = await provider.listen();
    const client = new EmberClient(host, port, 3000);
    clients.push(client);
    await client.connect();
    return client;
  }

  it('accepts a client, expands the required tree, and reads parameters', async () => {
    const client = await connectTo(MockEmberProvider.fromDump(createRequiredDump()));
    await client.expand(client.tree);
    const level = await client.getElementByPath('channel.channel1.level');
    expect(level?.contents).toMatchObject({ identifier: 'level', value: -6 });
    const integrated = await client.getElementByPath('system.loudness.integrated');
    expect(integrated?.contents).toMatchObject({ identifier: 'integrated', value: -23 });
  });

  it('notifies subscribers when pushParameter updates a value', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    const client = await connectTo(provider);
    await client.expand(client.tree);
    const meter = await client.getElementByPath('channel.channel1.meter');
    expect(meter).toBeDefined();
    const updates: unknown[] = [];
    await client.subscribe(meter as Model.NumberedTreeNode<Model.EmberElement>, (node) => {
      if (node.contents.type === Model.ElementType.Parameter) {
        updates.push(node.contents.value);
      }
    });
    expect(provider.pushParameter('channel/channel1/meter', -12.5)).toBe(true);
    await expect.poll(() => updates.at(-1)).toBe(-12.5);
  });

  it('applies writable setValue and rejects read-only writes', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    const client = await connectTo(provider);
    await client.expand(client.tree);
    const level = findNode(client.tree, 'channel', 'channel1', 'level');
    expect(level?.contents.type).toBe(Model.ElementType.Parameter);
    const write = await client.setValue(level as Model.NumberedTreeNode<Model.Parameter>, -3);
    await write.response;
    expect(provider.getParameter('channel/channel1/level')?.contents.value).toBe(-3);

    const meter = findNode(client.tree, 'channel', 'channel1', 'meter');
    expect(meter?.contents.type).toBe(Model.ElementType.Parameter);
    await client.setValue(meter as Model.NumberedTreeNode<Model.Parameter>, -1, false);
    expect(provider.getParameter('channel/channel1/meter')?.contents.value).toBe(-20);
  });

  it('invokes reset and restores loudness values', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    const client = await connectTo(provider);
    await client.expand(client.tree);
    expect(provider.pushParameter('system/loudness/integrated', -10)).toBe(true);
    const reset = await client.getElementByPath('system.loudness.reset');
    expect(reset?.contents.type).toBe(Model.ElementType.Function);
    const invocation = await client.invoke(reset as Model.NumberedTreeNode<Model.EmberFunction>);
    const result = await invocation.response;
    expect(result).toMatchObject({ success: true });
    await expect
      .poll(async () => {
        const integrated = await client.getElementByPath('system.loudness.integrated');
        return integrated?.contents.type === Model.ElementType.Parameter
          ? integrated.contents.value
          : undefined;
      })
      .toBe(-60);
  });

  it('inserts a new strip and marks it offline for subscribers', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    const client = await connectTo(provider);
    await client.expand(client.tree);
    const dump = createRequiredDump();
    const first = dump.nodes.find((node) => node.identifier === 'channel')?.children?.[0];
    expect(first).toBeDefined();
    expect(
      provider.addNode(
        'channel',
        dumpNodeToEmber({
          ...first!,
          number: 2,
          identifier: 'channel2',
          identifierPath: 'channel/channel2',
          numberPath: '1.2',
          description: 'PC',
          children: first!.children?.map((child) => ({
            ...child,
            numberPath: `1.2.${child.number}`,
            identifierPath: `channel/channel2/${child.identifier ?? child.number}`,
            value: child.identifier === 'name' ? 'PC' : child.value,
          })),
        }),
      ),
    ).toBe(true);
    await expect.poll(() => findNode(client.tree, 'channel', 'channel2')).toBeDefined();
    const added = findNode(client.tree, 'channel', 'channel2');
    expect(added).toBeDefined();
    const directory = await client.getDirectory(
      added as Model.NumberedTreeNode<Model.EmberElement>,
    );
    await directory.response;
    expect(provider.setNodeOnline('channel/channel2', false)).toBe(true);
    await expect
      .poll(() => {
        const node = findNode(client.tree, 'channel', 'channel2');
        return node !== undefined && 'isOnline' in node.contents ? node.contents.isOnline : true;
      })
      .toBe(false);
  });

  it('serves the archived live dump including required mixer nodes', async () => {
    const client = await connectTo(MockEmberProvider.fromDumpFile());
    await client.expand(client.tree);
    const bass = await client.getElementByPath('channel.channel3.name');
    expect(bass?.contents).toMatchObject({ value: 'BASS' });
    const mainMeter = await client.getElementByPath('main.main1.meter');
    expect(mainMeter?.contents.type).toBe(Model.ElementType.Parameter);
    const auxLevel = await client.getElementByPath('aux.aux1.level');
    expect(auxLevel?.contents.type).toBe(Model.ElementType.Parameter);
    const reset = await client.getElementByPath('system.loudness.reset');
    expect(reset?.contents.type).toBe(Model.ElementType.Function);
  });
});
