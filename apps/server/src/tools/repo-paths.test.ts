import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveRepoPath, resolveRepoRoot } from './repo-paths.js';

describe('repo path helpers', () => {
  it('resolves the monorepo root from a tools module URL', () => {
    const fromTools = pathToFileURL(path.join(process.cwd(), 'src', 'tools', 'dump-tree.ts')).href;
    expect(resolveRepoRoot(fromTools)).toBe(path.resolve(process.cwd(), '../..'));
  });

  it('keeps absolute output paths and resolves relative paths from the repo root', () => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const absolute = path.resolve(repoRoot, 'docs', 'tree-dumps', 'x.json');
    expect(resolveRepoPath(absolute, repoRoot)).toBe(absolute);
    expect(resolveRepoPath('docs/tree-dumps/x.json', repoRoot)).toBe(absolute);
  });
});
