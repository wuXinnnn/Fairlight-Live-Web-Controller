import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveRepoRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../../..');
}

export function resolveRepoPath(target: string, repoRoot: string = resolveRepoRoot()): string {
  return path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
}
