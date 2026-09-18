import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEmberClient } from './ember/fake-ember-client.js';
import { silentLogger } from './logger.js';
import { MixerRuntime } from './runtime.js';
import { resolveBindAddress, resolveEmberSeed, start } from './server.js';

describe('resolveBindAddress', () => {
  it('prefers explicit options over environment values', () => {
    expect(
      resolveBindAddress({ host: '0.0.0.0', port: 4000 }, { HOST: '10.0.0.1', PORT: '5000' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 4000,
    });
  });

  it('falls back to environment values', () => {
    expect(resolveBindAddress({}, { HOST: '10.0.0.1', PORT: '5000' })).toEqual({
      host: '10.0.0.1',
      port: 5000,
    });
  });

  it('falls back to localhost defaults', () => {
    expect(resolveBindAddress({}, {})).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });
});

describe('resolveEmberSeed', () => {
  const env = { EMBER_HOST: '10.0.0.8', EMBER_PORT: '9001' };

  it('reads the environment when no seed was given', () => {
    expect(resolveEmberSeed({}, silentLogger(), env)).toEqual({ host: '10.0.0.8', port: 9001 });
  });

  it('prefers an explicit seed over the environment', () => {
    expect(
      resolveEmberSeed({ emberSeed: { host: '10.0.0.9', port: 9002 } }, silentLogger(), env),
    ).toEqual({ host: '10.0.0.9', port: 9002 });
  });

  it('reads nothing at all for null, even with the environment set', () => {
    // `??` would treat null as absent and read the environment anyway, which is the pollution
    // the test fixtures and the soak driver pass null to prevent.
    expect(resolveEmberSeed({ emberSeed: null }, silentLogger(), env)).toBeUndefined();
  });
});

describe('start', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  async function startWithFake(options: { staticRoot?: string } = {}): Promise<FastifyInstance> {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-start-'));
    const runtime = new MixerRuntime({
      configPath: path.join(dir, 'config.json'),
      logger: silentLogger(),
      createClient: () => new FakeEmberClient(),
    });
    const started = await start({
      host: '127.0.0.1',
      port: 0,
      silent: true,
      runtime,
      ...options,
    });
    return started.app;
  }

  it('listens and serves health when the web dist is missing', async () => {
    app = await startWithFake({
      staticRoot: path.join(tmpdir(), 'flwc-missing-web-dist'),
    });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('serves static files when the web dist exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-web-dist-'));
    await writeFile(path.join(dir, 'index.html'), '<html>built</html>');
    try {
      app = await startWithFake({ staticRoot: dir });
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP address');
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('built');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
