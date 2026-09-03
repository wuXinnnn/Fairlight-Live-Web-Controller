import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { healthResponseSchema } from '@flwc/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns a valid health payload', async () => {
    const app = await createApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
  });

  it('serves static files when staticRoot is set', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-static-'));
    await writeFile(path.join(dir, 'index.html'), '<html>ok</html>');
    try {
      const app = await createApp({ staticRoot: dir });
      apps.push(app);
      const response = await app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('ok');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serves the SPA shell for client routes and keeps API misses as 404', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-static-'));
    await writeFile(path.join(dir, 'index.html'), '<html>shell</html>');
    try {
      const app = await createApp({ staticRoot: dir });
      apps.push(app);
      const clientRoute = await app.inject({ method: 'GET', url: '/views' });
      expect(clientRoute.statusCode).toBe(200);
      expect(clientRoute.body).toContain('shell');

      const apiMiss = await app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(apiMiss.statusCode).toBe(404);
      expect(apiMiss.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route /api/v1/nope not found' },
      });

      const postMiss = await app.inject({ method: 'POST', url: '/views' });
      expect(postMiss.statusCode).toBe(404);
      expect(postMiss.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not serve static files when staticRoot is omitted', async () => {
    const app = await createApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
  });
});
