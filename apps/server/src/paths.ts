import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveWebDist(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../web/dist');
}
