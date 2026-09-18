// Downloads the official Node.js runtime that ships inside the installer, so the target
// machine needs neither Node nor pnpm. The binary is never committed: it lands in
// src-tauri/binaries/, which is gitignored, and is verified against nodejs.org's SHASUMS256.txt
// before it is unpacked.
//
// Zero dependencies on purpose -- this runs before anything else in the bundle pipeline.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { get } from 'node:https';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Node.js release that ships inside the installer. Bump deliberately, not automatically. */
const NODE_VERSION = '22.23.2';

/**
 * Rust target triple -> what to take from nodejs.org.
 *
 * `archive` is the suffix of the release file name, `member` is the path of the executable
 * inside it, and `out` is the extension the sidecar file needs on that platform. Only the
 * Windows row is filled in: this batch ships a Windows installer only. The other rows are
 * commented out rather than absent so the shape is obvious when macOS is added.
 */
const TARGETS = {
  'x86_64-pc-windows-msvc': { archive: 'win-x64.zip', member: 'node.exe', out: '.exe' },
  // 'aarch64-apple-darwin': { archive: 'darwin-arm64.tar.gz', member: 'bin/node', out: '' },
  // 'x86_64-apple-darwin': { archive: 'darwin-x64.tar.gz', member: 'bin/node', out: '' },
  // 'x86_64-unknown-linux-gnu': { archive: 'linux-x64.tar.xz', member: 'bin/node', out: '' },
};

const here = dirname(fileURLToPath(import.meta.url));
const srcTauri = join(here, '..', 'src-tauri');
const binariesDir = join(srcTauri, 'binaries');
const resourcesDir = join(srcTauri, 'resources');

/** The triple this machine builds for, unless `--target <triple>` says otherwise. */
function resolveTriple(argv) {
  const flag = argv.indexOf('--target');
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (value === undefined) throw new Error('--target needs a target triple');
    return value;
  }
  const rustc = spawnSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' });
  if (rustc.status !== 0) {
    throw new Error(`could not ask rustc for the host target triple: ${rustc.stderr ?? ''}`);
  }
  return rustc.stdout.trim();
}

function download(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'user-agent': 'flwc-desktop-build' } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GET ${url} returned ${status}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * The tar to unpack with. On Windows this has to be the one in System32 -- that is bsdtar,
 * which reads zip; the GNU tar that comes with Git for Windows is first on PATH in a Git Bash
 * shell and cannot read zip at all.
 */
function systemTar() {
  if (process.platform !== 'win32') return 'tar';
  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(system32) ? system32 : 'tar';
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The one line of SHASUMS256.txt that covers `fileName`. */
function expectedDigest(shasums, fileName) {
  for (const line of shasums.split('\n')) {
    const [digest, name] = line.trim().split(/\s+/);
    if (name === fileName) return digest;
  }
  throw new Error(`${fileName} is not listed in SHASUMS256.txt`);
}

async function main() {
  const triple = resolveTriple(process.argv.slice(2));
  const target = TARGETS[triple];
  if (target === undefined) {
    const known = Object.keys(TARGETS).join(', ');
    throw new Error(`no Node.js download is mapped for ${triple}; mapped triples: ${known}`);
  }

  const binary = join(binariesDir, `node-${triple}${target.out}`);
  const license = join(resourcesDir, 'NODE_LICENSE');
  const stampPath = join(binariesDir, `node-${triple}.stamp`);
  const stamp = `${NODE_VERSION} ${target.archive}`;

  if (existsSync(binary) && existsSync(license) && existsSync(stampPath)) {
    if ((await readFile(stampPath, 'utf8')).trim() === stamp) {
      console.log(`node ${NODE_VERSION} for ${triple} is already in place`);
      return;
    }
  }

  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const fileName = `node-v${NODE_VERSION}-${target.archive}`;
  console.log(`downloading ${base}/${fileName}`);

  const [archive, shasums] = await Promise.all([
    download(`${base}/${fileName}`),
    download(`${base}/SHASUMS256.txt`).then((buffer) => buffer.toString('utf8')),
  ]);

  const want = expectedDigest(shasums, fileName);
  const got = sha256(archive);
  if (got !== want) {
    throw new Error(`checksum mismatch for ${fileName}: expected ${want}, got ${got}`);
  }
  console.log(`sha256 ok (${got})`);

  const work = await mkdtemp(join(tmpdir(), 'flwc-node-'));
  try {
    const archivePath = join(work, fileName);
    await writeFile(archivePath, archive);
    // Run tar with the archive as a bare name inside its own directory: GNU tar reads
    // `C:\...` as a remote host, and a relative name keeps every tar happy.
    const extracted = spawnSync(systemTar(), ['-xf', fileName], { cwd: work, stdio: 'inherit' });
    if (extracted.status !== 0) throw new Error(`tar failed to unpack ${fileName}`);

    // Every nodejs.org archive unpacks into a single directory named after the release.
    const root = join(work, fileName.replace(/\.(zip|tar\.gz|tar\.xz)$/, ''));
    await mkdir(binariesDir, { recursive: true });
    await mkdir(resourcesDir, { recursive: true });
    await copyFile(join(root, target.member), binary);
    await copyFile(join(root, 'LICENSE'), license);
    await writeFile(stampPath, `${stamp}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  console.log(`node ${NODE_VERSION} -> ${binary}`);
}

await main();
