import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequiredDump, findFreePort, MockEmberProvider } from '@flwc/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { StartedServer } from '../src/server.js';
import { start } from '../src/server.js';

const providers: MockEmberProvider[] = [];
const servers: StartedServer[] = [];
const directories: string[] = [];
const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) {
    savedEnv.set(name, process.env[name]);
  }
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

afterEach(async () => {
  await Promise.allSettled(servers.map((server) => server.app.close()));
  servers.length = 0;
  for (const provider of providers) {
    provider.close();
  }
  providers.length = 0;
  await Promise.allSettled(directories.map((dir) => rm(dir, { recursive: true, force: true })));
  directories.length = 0;
  for (const [name, value] of savedEnv) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
  savedEnv.clear();
});

async function startProvider(): Promise<{ host: string; port: number }> {
  const provider = MockEmberProvider.fromDump(createRequiredDump());
  providers.push(provider);
  return provider.listen();
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(dir);
  return dir;
}

async function startOn(configDir: string, emberSeed: { host: string; port: number }): Promise<URL> {
  const httpPort = await findFreePort('127.0.0.1');
  const server = await start({
    host: '127.0.0.1',
    port: httpPort,
    configDir,
    silent: true,
    emberSeed,
    timeoutMs: 3000,
    busDirectoryPollMs: 0,
  });
  servers.push(server);
  return new URL(`http://127.0.0.1:${httpPort}/`);
}

describe('environment seeding', { timeout: 20_000 }, () => {
  it('seeds a missing config file, then lets the file win over a different seed', async () => {
    const first = await startProvider();
    const configDir = await tempDir('flwc-env-seed-');

    const base = await startOn(configDir, first);
    const seeded = (await (await fetch(new URL('api/v1/connection', base))).json()) as {
      host: string;
      port: number;
      status: string;
    };
    expect(seeded).toMatchObject({ host: first.host, port: first.port });
    await expect
      .poll(async () => {
        const body = (await (await fetch(new URL('api/v1/connection', base))).json()) as {
          status: string;
        };
        return body.status;
      })
      .toBe('connected');

    // Point it somewhere else the way the CONNECTION panel does.
    const second = await startProvider();
    const put = await fetch(new URL('api/v1/connection', base), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(second),
    });
    expect(put.status).toBe(200);

    await servers.pop()?.app.close();

    // Restart on the same directory with a seed that says something else entirely. The file was
    // written on the first start, so nothing in the environment gets a say any more.
    const third = await startProvider();
    const restarted = await startOn(configDir, third);
    const afterRestart = (await (await fetch(new URL('api/v1/connection', restarted))).json()) as {
      host: string;
      port: number;
    };
    expect(afterRestart).toMatchObject({ host: second.host, port: second.port });
  });

  it('serves the web root and writes the config where the environment points', async () => {
    const webRoot = await tempDir('flwc-env-web-');
    const dataDir = await tempDir('flwc-env-data-');
    await writeFile(path.join(webRoot, 'index.html'), '<html>from FLWC_WEB_ROOT</html>', 'utf8');

    setEnv('FLWC_WEB_ROOT', webRoot);
    setEnv('FLWC_DATA_DIR', dataDir);

    const ember = await startProvider();
    const httpPort = await findFreePort('127.0.0.1');
    const server = await start({
      host: '127.0.0.1',
      port: httpPort,
      silent: true,
      emberSeed: ember,
      timeoutMs: 3000,
      busDirectoryPollMs: 0,
    });
    servers.push(server);
    const base = new URL(`http://127.0.0.1:${httpPort}/`);

    expect(await (await fetch(base)).text()).toContain('from FLWC_WEB_ROOT');

    const written: unknown = JSON.parse(await readFile(path.join(dataDir, 'config.json'), 'utf8'));
    expect(written).toMatchObject({ ember: { host: ember.host, port: ember.port } });
  });
});
