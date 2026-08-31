import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DumpNode, DumpTree } from './dump-types.js';

export function resolveRepoRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../..');
}

export function resolveDumpDirectory(repoRoot: string = resolveRepoRoot()): string {
  return path.join(repoRoot, 'docs', 'tree-dumps');
}

export function resolveLatestDumpPath(repoRoot: string = resolveRepoRoot()): string {
  const directory = resolveDumpDirectory(repoRoot);
  let files: string[] = [];
  try {
    files = readdirSync(directory).filter((name) =>
      /^fairlight-live-\d{4}-\d{2}-\d{2}\.json$/.test(name),
    );
  } catch {
    files = [];
  }
  const latest = files.sort().at(-1);
  if (latest === undefined) {
    throw new Error(`No Fairlight dump JSON found in ${directory}`);
  }
  return path.join(directory, latest);
}

export function loadDumpTree(filePath: string = resolveLatestDumpPath()): DumpTree {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isDumpTree(parsed)) {
    throw new Error(`Invalid Ember+ dump JSON: ${filePath}`);
  }
  return parsed;
}

export function isDumpTree(value: unknown): value is DumpTree {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DumpTree>;
  return (
    typeof candidate.dumpedAt === 'string' &&
    typeof candidate.host === 'string' &&
    typeof candidate.port === 'number' &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isDumpNode) &&
    Array.isArray(candidate.errors)
  );
}

function isDumpNode(value: unknown): value is DumpNode {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const node = value as Partial<DumpNode>;
  return (
    typeof node.number === 'number' &&
    typeof node.numberPath === 'string' &&
    typeof node.identifierPath === 'string' &&
    typeof node.elementType === 'string'
  );
}
