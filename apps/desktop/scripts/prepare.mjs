// Everything that has to exist before cargo is allowed to look at src-tauri: the Node sidecar,
// the staged backend and web build, and the generated icon set. tauri.conf.json runs this as
// the first half of beforeDevCommand and beforeBuildCommand, and desktop.yml runs it before
// cargo, because build.rs fails outright when binaries/ or resources/ are missing.

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');

/** The mixer page's app icon is the launcher's icon too; `tauri icon` derives every size. */
const ICON_SOURCE = join(desktop, '..', 'web', 'public', 'icon-512.png');

/**
 * Both typefaces are OFL-1.1, which asks for the licence to travel with the font, and the
 * installer puts the woff2 files on the user's machine. So they are staged the same way the
 * Node runtime's licence is, as bundle resources. The names match the entries in
 * tauri.conf.json's `bundle.resources`.
 */
const FONT_LICENCES = {
  '@fontsource/barlow-condensed': 'FONT_LICENSE_BARLOW_CONDENSED',
  '@fontsource/ibm-plex-mono': 'FONT_LICENSE_IBM_PLEX_MONO',
};

/**
 * `shell` is only for `pnpm`, which on Windows is a .cmd that spawn cannot run directly.
 * Node's own path must not go through a shell: it contains a space on a default Windows
 * install, and cmd.exe would split it at `C:\Program`.
 */
function run(command, args, { shell = false } = {}) {
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', shell });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'a signal'}`);
  }
}

run(process.execPath, [join(here, 'fetch-node.mjs'), ...process.argv.slice(2)]);

/** Resolved rather than path-joined: pnpm keeps the real package outside apps/desktop. */
async function stageFontLicences() {
  const require = createRequire(join(desktop, 'package.json'));
  const resources = join(desktop, 'src-tauri', 'resources');
  await mkdir(resources, { recursive: true });
  for (const [pkg, name] of Object.entries(FONT_LICENCES)) {
    const source = join(dirname(require.resolve(`${pkg}/package.json`)), 'LICENSE');
    await copyFile(source, join(resources, name));
  }
}

run(process.execPath, [join(here, 'stage-server.mjs')]);
await stageFontLicences();
run('pnpm', ['exec', 'tauri', 'icon', ICON_SOURCE, '-o', join(desktop, 'src-tauri', 'icons')], {
  shell: process.platform === 'win32',
});
