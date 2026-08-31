import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeEmberClient } from '../ember/fake-ember-client.js';
import { silentLogger } from '../logger.js';
import { MixerRuntime } from '../runtime.js';

describe('connection routes', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
  const runtimes: MixerRuntime[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  });

  async function setup(): Promise<{
    app: Awaited<ReturnType<typeof createApp>>;
    runtime: MixerRuntime;
  }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-api-'));
    await writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        ember: { host: '127.0.0.1', port: 1 },
        views: [],
      }),
      'utf8',
    );
    const runtime = new MixerRuntime({
      configPath: path.join(dir, 'config.json'),
      logger: silentLogger(),
      createClient: () => new FakeEmberClient(),
    });
    await runtime.start();
    runtimes.push(runtime);
    const app = await createApp({ runtime });
    apps.push(app);
    return { app, runtime };
  }

  it('returns the current ember endpoint and status', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/connection' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      host: '127.0.0.1',
      port: 1,
      status: 'connected',
    });
  });

  it('rejects an invalid PUT body', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/connection',
      payload: { host: '', port: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION' },
    });
  });

  it('updates the endpoint and persists it', async () => {
    const { app, runtime } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/connection',
      payload: { host: '10.0.0.8', port: 9001 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ host: '10.0.0.8', port: 9001 });
    expect(runtime.config.snapshot.ember).toEqual({ host: '10.0.0.8', port: 9001 });
  });

  it('uses the error handler for unexpected failures', async () => {
    const app = await createApp();
    apps.push(app);
    app.get('/api/v1/boom', async () => {
      throw new Error('explode');
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL', message: 'explode' } });
  });
});
