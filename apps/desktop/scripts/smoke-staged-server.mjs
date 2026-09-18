// Starts the staged backend exactly the way the launcher will and checks that it comes up and
// goes away again. It is the cheapest proof that staging produced a self-contained tree: a
// missing dependency, a skipped link or a stale build all show up here rather than on a user's
// machine after an install.
//
// Kept out of prepare.mjs so `tauri dev` stays fast; desktop.yml runs it as its own step.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resources = join(here, '..', 'src-tauri', 'resources');
const mainJs = join(resources, 'server', 'dist', 'main.js');
const webRoot = join(resources, 'web');

/** How long the server gets to answer its health check, and then to exit on stdin close. */
const READY_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 10_000;

/** A port the OS just handed out is free, and never one of the ports a developer is using. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!existsSync(mainJs)) {
    throw new Error(`nothing staged at ${mainJs}; run scripts/stage-server.mjs first`);
  }

  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'flwc-smoke-'));
  let output = '';

  // EMBER_HOST/EMBER_PORT are seeds for a config.json that does not exist yet. They are
  // pointed at a port with nothing on it on purpose: this check is about the HTTP server
  // coming up, and it must never reach a real Fairlight Live.
  const child = spawn(process.execPath, [mainJs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      FLWC_WEB_ROOT: webRoot,
      FLWC_DATA_DIR: dataDir,
      FLWC_EXIT_ON_STDIN_CLOSE: '1',
      EMBER_HOST: '127.0.0.1',
      EMBER_PORT: '1',
      NODE_ENV: 'production',
    },
  });
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
        ready = response.ok && (await response.json()).status === 'ok';
      } catch {
        // Not listening yet.
      }
      if (!ready) await sleep(200);
    }
    if (!ready) throw new Error(`the staged server never answered /api/v1/health\n${output}`);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    if (!page.ok) throw new Error(`the staged web root did not serve /: ${page.status}`);
    console.log(`health ok and / served from the staged web root on port ${port}`);

    // The launcher's whole process boundary is this: close stdin, the server sees EOF and
    // shuts itself down. Prove it here, where a regression is cheap to find.
    const closedAt = Date.now();
    child.stdin.end();
    const code = await Promise.race([exited, sleep(EXIT_TIMEOUT_MS).then(() => 'timeout')]);
    if (code === 'timeout') {
      child.kill();
      throw new Error('the staged server did not exit within 10s of stdin closing');
    }
    if (code !== 0) throw new Error(`the staged server exited with ${code}, expected 0\n${output}`);
    console.log(`exited cleanly ${Date.now() - closedAt} ms after stdin closed`);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
}

await main();
