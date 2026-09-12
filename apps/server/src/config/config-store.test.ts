import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultAppConfig } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { ConfigStore } from './config-store.js';

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'flwc-config-'));
  return path.join(dir, 'config.json');
}

describe('ConfigStore', () => {
  it('returns defaults when the file is missing', async () => {
    const filePath = await tempConfigPath();
    const store = new ConfigStore(filePath, silentLogger());
    await expect(store.load()).resolves.toEqual(defaultAppConfig());
  });

  it('returns defaults when the file is corrupt', async () => {
    const filePath = await tempConfigPath();
    await writeFile(filePath, '{not json', 'utf8');
    const store = new ConfigStore(filePath, silentLogger());
    await expect(store.load()).resolves.toEqual(defaultAppConfig());
  });

  it('returns defaults when the file fails schema validation', async () => {
    const filePath = await tempConfigPath();
    await writeFile(filePath, JSON.stringify({ version: 3 }), 'utf8');
    const store = new ConfigStore(filePath, silentLogger());
    await expect(store.load()).resolves.toEqual(defaultAppConfig());
  });

  it('atomically writes and reloads a valid config', async () => {
    const filePath = await tempConfigPath();
    const store = new ConfigStore(filePath, silentLogger());
    const saved = await store.save({
      version: 2,
      ember: { host: '10.0.0.8', port: 9001 },
      views: [],
    });
    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual(saved);
    const loaded = new ConfigStore(filePath, silentLogger());
    await expect(loaded.load()).resolves.toEqual(saved);
  });

  it('reads a version 1 file as version 2 and writes it back that way', async () => {
    const filePath = await tempConfigPath();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        ember: { host: '10.0.0.8', port: 9001 },
        views: [
          {
            id: 'foh',
            name: 'FOH',
            channels: [
              { kind: 'channel', name: 'BASS', channelId: 'channel/1', groupId: 'g1' },
              { kind: 'channel', name: 'GTR', channelId: 'channel/2', groupId: 'g1' },
              { kind: 'main', name: 'Main', channelId: 'main/1' },
              { kind: 'aux', name: 'FX', channelId: 'aux/1', groupId: 'g2' },
              { kind: 'sub', name: 'SUB', channelId: 'sub/1', groupId: 'ghost' },
              { channelId: 'mtx/1', lastKnownName: 'Matrix' },
            ],
            groups: [
              { id: 'g1', name: 'Rhythm' },
              { id: 'g2', name: 'Sends' },
              { id: 'g3', name: 'Spare' },
            ],
          },
        ],
      }),
      'utf8',
    );
    const store = new ConfigStore(filePath, silentLogger());
    const loaded = await store.load();

    expect(loaded.version).toBe(2);
    expect(loaded.views[0]?.items).toEqual([
      {
        type: 'group',
        id: 'g1',
        name: 'Rhythm',
        channels: [
          { kind: 'channel', name: 'BASS', channelId: 'channel/1' },
          { kind: 'channel', name: 'GTR', channelId: 'channel/2' },
        ],
      },
      { type: 'channel', kind: 'main', name: 'Main', channelId: 'main/1' },
      {
        type: 'group',
        id: 'g2',
        name: 'Sends',
        channels: [{ kind: 'aux', name: 'FX', channelId: 'aux/1' }],
      },
      // The group this one named does not exist, so it reads as an ungrouped row.
      { type: 'channel', kind: 'sub', name: 'SUB', channelId: 'sub/1' },
      // And the pre-grouping reference shape is brought forward on the way.
      { type: 'channel', kind: 'mtx', name: 'Matrix', channelId: 'mtx/1' },
      // A group nobody referenced keeps its place at the end, where it used to be shown.
      { type: 'group', id: 'g3', name: 'Spare', channels: [] },
    ]);

    // The next write is version 2 without the server knowing anything about the migration.
    await store.update((current) => ({ ...current, ember: { host: '127.0.0.1', port: 9000 } }));
    const written = JSON.parse(await readFile(filePath, 'utf8')) as { version: number };
    expect(written.version).toBe(2);
    expect(written).toEqual(store.snapshot);
  });

  it('serializes concurrent updates', async () => {
    const filePath = await tempConfigPath();
    const store = new ConfigStore(filePath, silentLogger());
    await store.load();
    await Promise.all([
      store.update((current) => ({
        ...current,
        ember: { host: '127.0.0.1', port: 1001 },
      })),
      store.update((current) => ({
        ...current,
        ember: { host: '127.0.0.1', port: 1002 },
      })),
      store.update((current) => ({
        ...current,
        ember: { host: '127.0.0.1', port: 1003 },
      })),
    ]);
    expect([1001, 1002, 1003]).toContain(store.snapshot.ember.port);
    const reloaded = new ConfigStore(filePath, silentLogger());
    await reloaded.load();
    expect(reloaded.snapshot.ember.port).toBe(store.snapshot.ember.port);
  });
});
