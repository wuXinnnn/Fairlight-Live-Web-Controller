// Lays the built backend and the built mixer page into src-tauri/resources/, which is what
// Tauri bundles into the installer. Nothing here is committed; the whole directory is
// gitignored and rebuilt from `pnpm build` output every time.
//
// The one rule that matters: the staged tree must contain no symlinks and no junctions.
// Tauri walks resources with walkdir and does not follow links -- a linked directory is
// neither expanded nor reported, it is silently skipped, and the installer ends up missing
// dependencies that only fail on the user's machine. pnpm's default isolated layout is built
// entirely out of such links, so the deploy below forces a hoisted one and assertNoLinks()
// turns any survivor into a loud failure.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const repoRoot = join(desktop, '..', '..');
const resources = join(desktop, 'src-tauri', 'resources');
const serverStage = join(resources, 'server');
const webStage = join(resources, 'web');

/** What `pnpm build` has to have produced before staging can run at all. */
const PREREQUISITES = [
  join(repoRoot, 'apps', 'server', 'dist', 'main.js'),
  join(repoRoot, 'apps', 'web', 'dist', 'index.html'),
  join(repoRoot, 'packages', 'shared', 'dist', 'index.js'),
];

/**
 * Files whose absence means the staged tree would start and then fail at runtime.
 * `dist/tools` is on the list because it is not a directory of developer tooling:
 * ember-service.js imports expand-ember-tree.js out of it.
 */
const REQUIRED_IN_STAGE = [
  join(serverStage, 'dist', 'main.js'),
  join(serverStage, 'dist', 'tools', 'expand-ember-tree.js'),
  join(serverStage, 'node_modules', '@flwc', 'shared', 'dist', 'index.js'),
  join(serverStage, 'node_modules', 'zod', 'package.json'),
  join(serverStage, 'node_modules', 'fastify', 'package.json'),
  join(webStage, 'index.html'),
];

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'a signal'}`);
  }
}

/** Walks `root` with lstat and throws on the first link of any kind. */
async function assertNoLinks(root) {
  const stack = [root];
  let checked = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      checked += 1;
      if ((await lstat(path)).isSymbolicLink()) {
        throw new Error(
          `${relative(root, path)} is a link; Tauri's resource walk would skip it silently. ` +
            'Staging must produce real files only.',
        );
      }
      if (entry.isDirectory()) stack.push(path);
    }
  }
  return checked;
}

async function main() {
  const missing = PREREQUISITES.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    const list = missing.map((path) => relative(repoRoot, path)).join(', ');
    throw new Error(`run \`pnpm build\` first; missing: ${list}`);
  }

  await rm(serverStage, { recursive: true, force: true });
  await rm(webStage, { recursive: true, force: true });
  await mkdir(resources, { recursive: true });

  // --legacy: pnpm 11.17 still refuses a deploy of a workspace package that is not injected.
  // --ignore-scripts: @flwc/shared's `prepare` runs tsc, and --prod does not install it.
  // node-linker=hoisted + package-import-method=copy: real directories, no link farm.
  run(
    'pnpm',
    [
      '--filter',
      '@flwc/server',
      'deploy',
      '--prod',
      '--legacy',
      '--ignore-scripts',
      '--config.node-linker=hoisted',
      '--config.package-import-method=copy',
      serverStage,
    ],
    repoRoot,
  );

  await cp(join(repoRoot, 'apps', 'web', 'dist'), webStage, { recursive: true });

  const stillMissing = REQUIRED_IN_STAGE.filter((path) => !existsSync(path));
  if (stillMissing.length > 0) {
    const list = stillMissing.map((path) => relative(resources, path)).join(', ');
    throw new Error(`the staged tree is incomplete; missing: ${list}`);
  }

  const checked = await assertNoLinks(resources);
  console.log(`staged the server and the web build into resources/ (${checked} entries, no links)`);
}

await main();
