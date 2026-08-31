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
    await writeFile(filePath, JSON.stringify({ version: 2 }), 'utf8');
    const store = new ConfigStore(filePath, silentLogger());
    await expect(store.load()).resolves.toEqual(defaultAppConfig());
  });

  it('atomically writes and reloads a valid config', async () => {
    const filePath = await tempConfigPath();
    const store = new ConfigStore(filePath, silentLogger());
    const saved = await store.save({
      version: 1,
      ember: { host: '10.0.0.8', port: 9001 },
      views: [],
    });
    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual(saved);
    const loaded = new ConfigStore(filePath, silentLogger());
    await expect(loaded.load()).resolves.toEqual(saved);
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
