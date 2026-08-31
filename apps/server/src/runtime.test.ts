import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChannelNotFoundError } from './ember/errors.js';
import { FakeEmberClient } from './ember/fake-ember-client.js';
import { requiredTree, stripNode } from './ember/tree-helpers.js';
import { silentLogger } from './logger.js';
import { MixerRuntime } from './runtime.js';

describe('MixerRuntime', () => {
  const runtimes: MixerRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  });

  async function startRuntime(client: FakeEmberClient = new FakeEmberClient()): Promise<{
    runtime: MixerRuntime;
    client: FakeEmberClient;
  }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-runtime-'));
    const runtime = new MixerRuntime({
      configPath: path.join(dir, 'config.json'),
      logger: silentLogger(),
      host: '127.0.0.1',
      port: 1,
      createClient: () => client,
    });
    runtimes.push(runtime);
    await runtime.start();
    await runtime.start();
    return { runtime, client };
  }

  it('maps the tree and applies control writes', async () => {
    const { runtime, client } = await startRuntime();
    expect(runtime.store.getChannel('channel/1')?.name).toBe('BASS');
    await runtime.setLevel('channel/1', -3);
    await runtime.setOn('channel/1', false);
    await runtime.resetLoudness();
    expect(client.setValueCalls).toEqual([-3, true]);
    expect(client.invokeCalls).toBe(1);
    await expect(runtime.setLevel('channel/9', 0)).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  it('emits a snapshot when the mapped tree changes', async () => {
    const client = new FakeEmberClient();
    const { runtime } = await startRuntime(client);
    const snapshots: unknown[] = [];
    runtime.store.on('snapshot', (snapshot) => snapshots.push(snapshot));
    const next = requiredTree();
    const channelRoot = next[1];
    if (channelRoot?.children !== undefined) {
      channelRoot.children[2] = stripNode('channel', 2, 'PC');
    }
    client.tree = next;
    await runtime.ember.refreshTree();
    await expect.poll(() => snapshots.length).toBeGreaterThan(0);
    expect(runtime.store.getChannel('channel/2')?.name).toBe('PC');
  });
});
