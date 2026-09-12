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
        items: [
          { type: 'channel', kind: 'channel', name: 'BASS', channelId: 'channel/1', color: 'lime' },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      id: expect.any(String),
      name: 'Broadcast',
      items: [
        { type: 'channel', kind: 'channel', name: 'BASS', channelId: 'channel/1', color: 'lime' },
      ],
    });
    const id = created.json<{ id: string }>().id;

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/views/${id}`,
      payload: {
        name: 'FOH',
        items: [
          {
            type: 'group',
            id: 'buses',
            name: 'Buses',
            channels: [{ kind: 'main', name: 'Main', channelId: 'main/1' }],
          },
          { type: 'channel', kind: 'aux', name: 'Temporary' },
          // A group with no members is a block of its own and round-trips like any other.
          { type: 'group', id: 'spare', name: 'Spare', channels: [] },
        ],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      id,
      name: 'FOH',
      items: [
        {
          type: 'group',
          id: 'buses',
          name: 'Buses',
          channels: [{ kind: 'main', name: 'Main', channelId: 'main/1' }],
        },
        { type: 'channel', kind: 'aux', name: 'Temporary' },
        { type: 'group', id: 'spare', name: 'Spare', channels: [] },
      ],
    });
    expect(JSON.parse(await readFile(configPath, 'utf8')).views).toEqual([updated.json()]);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/views' });
    expect(listed.json()).toEqual([updated.json()]);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/views/${id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([]);
  });

  it('persists group colours and channels that follow them', async () => {
    const { app, configPath } = await setup();
    const payload = {
      name: 'FOH',
      items: [
        {
          type: 'group',
          id: 'g1',
          name: 'Rhythm',
          color: 'teal',
          channels: [{ kind: 'channel', name: 'BASS', channelId: 'channel/3', color: 'group' }],
        },
        { type: 'channel', kind: 'main', name: 'Main', color: 'purple' },
      ],
    };
    const created = await app.inject({ method: 'POST', url: '/api/v1/views', payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      items: [
        { type: 'group', color: 'teal', channels: [{ color: 'group' }] },
        { type: 'channel', color: 'purple' },
      ],
    });

    const listed = (await app.inject({ method: 'GET', url: '/api/v1/views' })).json();
    expect(listed[0].items[0].color).toBe('teal');
    expect(listed[0].items[0].channels[0].color).toBe('group');
    const persisted = JSON.parse(await readFile(configPath, 'utf8'));
    expect(persisted.views[0].items[0].color).toBe('teal');
    expect(persisted.version).toBe(2);

    // A channel can only follow a group colour while it belongs to a group.
    const orphan = await app.inject({
      method: 'PUT',
      url: `/api/v1/views/${created.json().id}`,
      payload: {
        name: 'FOH',
        items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'group' }],
      },
    });
    expect(orphan.statusCode).toBe(400);
    expect(orphan.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/views' })).json()[0].items,
    ).toHaveLength(2);
  });

  it('rejects invalid payloads without changing persisted views', async () => {
    const { app } = await setup();
    for (const payload of [
      { name: ' ', items: [] },
      {
        name: 'FOH',
        items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'orange' }],
      },
      // The pre-grouping reference shape is migrated when a config file is read, but it is no
      // longer accepted over the wire: the page and the server ship together.
      { name: 'FOH', items: [{ type: 'channel', channelId: 'main/1', lastKnownName: 'Main' }] },
      { name: 'FOH', items: [{ type: 'channel', kind: 'strip', name: 'BASS' }] },
      // An item has to say which kind it is.
      { name: 'FOH', items: [{ kind: 'channel', name: 'BASS' }] },
      // Only a member of a group may follow a group colour.
      { name: 'FOH', items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'group' }] },
      {
        name: 'FOH',
        items: [
          { type: 'group', id: 'g1', name: 'Rhythm', channels: [] },
          { type: 'group', id: 'g1', name: 'Vocals', channels: [] },
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
      payload: { name: 'FOH', items: [] },
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

  it('serves a version 1 config as version 2 items and writes it back that way', async () => {
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
              { channelId: 'aux/2', lastKnownName: 'FX', color: 'lime', groupId: 'g1' },
              { channelId: 'main/1', lastKnownName: '' },
            ],
            groups: [
              { id: 'g1', name: 'Sends' },
              { id: 'g2', name: 'Spare' },
            ],
          },
        ],
      }),
    );
    const migrated = {
      id: 'legacy',
      name: 'Legacy',
      items: [
        { type: 'channel', kind: 'channel', name: 'BASS', channelId: 'channel/1' },
        {
          type: 'group',
          id: 'g1',
          name: 'Sends',
          channels: [{ kind: 'aux', name: 'FX', channelId: 'aux/2', color: 'lime' }],
        },
        // An empty name falls back to the id, so one bad entry cannot void the file.
        { type: 'channel', kind: 'main', name: 'main/1', channelId: 'main/1' },
        { type: 'group', id: 'g2', name: 'Spare', channels: [] },
      ],
    };
    expect((await legacy.app.inject({ method: 'GET', url: '/api/v1/views' })).json()).toEqual([
      migrated,
    ]);

    // Any write rewrites the whole file, so the old shape is gone from disk afterwards.
    const written = await legacy.app.inject({
      method: 'POST',
      url: '/api/v1/views',
      payload: { name: 'Second', items: [] },
    });
    expect(written.statusCode).toBe(201);
    const persisted = JSON.parse(await readFile(legacy.configPath, 'utf8'));
    expect(persisted.version).toBe(2);
    expect(persisted.views).toEqual([migrated, written.json()]);
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
          payload: { name, items: [] },
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
