// Everything that has to exist before cargo is allowed to look at src-tauri: the Node sidecar,
// the staged backend and web build, and the generated icon set. tauri.conf.json runs this as
// the first half of beforeDevCommand and beforeBuildCommand, and desktop.yml runs it before
// cargo, because build.rs fails outright when binaries/ or resources/ are missing.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');

/** The mixer page's app icon is the launcher's icon too; `tauri icon` derives every size. */
const ICON_SOURCE = join(desktop, '..', 'web', 'public', 'icon-512.png');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktop,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'a signal'}`);
  }
}

run(process.execPath, [join(here, 'fetch-node.mjs'), ...process.argv.slice(2)]);
run(process.execPath, [join(here, 'stage-server.mjs')]);
run('pnpm', ['exec', 'tauri', 'icon', ICON_SOURCE, '-o', join(desktop, 'src-tauri', 'icons')]);
