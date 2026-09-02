import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeEmberClient } from '../ember/fake-ember-client.js';
import { silentLogger } from '../logger.js';
import { MixerRuntime } from '../runtime.js';

describe('view routes', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
  const runtimes: MixerRuntime[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function setup(initialFile?: string) {
    const directory = await mkdtemp(path.join(tmpdir(), 'flwc-views-api-'));
    directories.push(directory);
    const configPath = path.join(directory, 'config.json');
    if (initialFile !== undefined) {
      await writeFile(configPath, initialFile, 'utf8');
    }
    const runtime = new MixerRuntime({
      configPath,
      logger: silentLogger(),
      createClient: () => new FakeEmberClient(),
    });
    runtimes.push(runtime);
    await runtime.start();
    const app = await createApp({ runtime });
    apps.push(app);
    return { app, configPath };
  }

  it('creates, lists, updates, persists, and deletes views', async () => {
    const { app, configPath } = await setup();
    const initial = await app.inject({ method: 'GET', url: '/api/v1/views' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual([]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/views',
      payload: {
        name: '  Broadcast  ',
        channels: [{ kind: 'channel', name: 'BASS', channelId: 'channel/1', color: 'lime' }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      id: expect.any(String),
      name: 'Broadcast',
      channels: [{ kind: 'channel', name: 'BASS', channelId: 'channel/1', color: 'lime' }],
      groups: [],
    });
    const id = created.json<{ id: string }>().id;

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/views/${id}`,
      payload: {
        name: 'FOH',
        channels: [
          { kind: 'main', name: 'Main', channelId: 'main/1', groupId: 'buses' },
          { kind: 'aux', name: 'Temporary' },
        ],
        groups: [{ id: 'buses', name: 'Buses' }],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      id,
      name: 'FOH',
      channels: [
        { kind: 'main', name: 'Main', channelId: 'main/1', groupId: 'buses' },
        { kind: 'aux', name: 'Temporary' },
      ],
      groups: [{ id: 'buses', name: 'Buses' }],
    });
    expect(JSON.parse(await readFile(configPath, 'utf8')).views).toEqual([updated.json()]);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/views' });
    expect(listed.json()).toEqual([updated.json()]);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/views/${id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([]);
  });

  it('rejects invalid payloads without changing persisted views', async () => {
    const { app } = await setup();
    for (const payload of [
      { name: ' ', channels: [] },
      {
        name: 'FOH',
        channels: [{ kind: 'channel', name: 'BASS', color: 'orange' }],
      },
      { name: 'FOH', channels: [{ lastKnownName: 'BASS' }] },
      { name: 'FOH', channels: [{ kind: 'strip', name: 'BASS' }] },
      { name: 'FOH', channels: [{ kind: 'channel', name: 'BASS', groupId: 'ghost' }], groups: [] },
      {
        name: 'FOH',
        channels: [],
        groups: [
          { id: 'g1', name: 'Rhythm' },
          { id: 'g1', name: 'Vocals' },
        ],
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/views',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([]);
  });

  it('returns not found for unknown view updates and deletes', async () => {
    const { app } = await setup();
    const update = await app.inject({
      method: 'PUT',
      url: '/api/v1/views/unknown',
      payload: { name: 'FOH', channels: [] },
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/v1/views/unknown',
    });
    expect(update.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
    expect(update.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(remove.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('migrates legacy view references on load and on write', async () => {
    const legacy = await setup(
      JSON.stringify({
        version: 1,
        ember: { host: '127.0.0.1', port: 1 },
        views: [
          {
            id: 'legacy',
            name: 'Legacy',
            channels: [
              { channelId: 'channel/1', lastKnownName: 'BASS' },
              { channelId: 'aux/2', lastKnownName: 'FX', color: 'lime' },
            ],
          },
        ],
      }),
    );
    const migrated = {
      id: 'legacy',
      name: 'Legacy',
      channels: [
        { kind: 'channel', name: 'BASS', channelId: 'channel/1' },
        { kind: 'aux', name: 'FX', channelId: 'aux/2', color: 'lime' },
      ],
      groups: [],
    };
    expect((await legacy.app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([
      migrated,
    ]);

    const written = await legacy.app.inject({
      method: 'POST',
      url: '/api/v1/views',
      payload: {
        name: 'Legacy client',
        channels: [{ channelId: 'main/1', lastKnownName: 'Main' }],
      },
    });
    expect(written.statusCode).toBe(201);
    expect(written.json()).toMatchObject({
      channels: [{ kind: 'main', name: 'Main', channelId: 'main/1' }],
      groups: [],
    });
    expect(JSON.parse(await readFile(legacy.configPath, 'utf8')).views).toEqual([
      migrated,
      written.json(),
    ]);
  });

  it('recovers empty views from corrupt config', async () => {
    const corrupt = await setup('{not json');
    expect((await corrupt.app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([]);
  });

  it('serializes concurrent view creation', async () => {
    const { app } = await setup();
    const responses = await Promise.all(
      ['FOH', 'Broadcast'].map((name) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/views',
          payload: { name, channels: [] },
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    const views = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/views',
      })
    ).json<Array<{ name: string }>>();
    expect(views.map((view) => view.name)).toEqual(['FOH', 'Broadcast']);
  });
});
