import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRequiredDump } from './fixtures.js';
import { isDumpTree, loadDumpTree, resolveLatestDumpPath, resolveRepoRoot } from './load-dump.js';

describe('isDumpTree', () => {
  it('accepts a valid dump and rejects malformed objects', () => {
    expect(isDumpTree(createRequiredDump())).toBe(true);
    expect(isDumpTree(null)).toBe(false);
    expect(isDumpTree({ dumpedAt: 'x' })).toBe(false);
  });
});

describe('loadDumpTree', () => {
  it('loads the archived live dump from the repo', () => {
    const dump = loadDumpTree();
    expect(dump.host).toBe('127.0.0.1');
    expect(dump.port).toBe(9000);
    expect(dump.nodes.some((node) => node.identifier === 'channel')).toBe(true);
    expect(resolveLatestDumpPath()).toContain('fairlight-live-');
  });

  it('rejects invalid JSON files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flwc-dump-'));
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{"nope":true}');
    try {
      expect(() => loadDumpTree(file)).toThrow('Invalid Ember+ dump JSON');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves the monorepo root from this package', () => {
    expect(resolveRepoRoot()).toBe(path.resolve(process.cwd(), '../..'));
  });

  it('throws when the dump directory has no dated snapshots', () => {
    expect(() => resolveLatestDumpPath(tmpdir())).toThrow('No Fairlight dump JSON found');
  });
});
