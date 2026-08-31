import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveWebDist } from './paths.js';

describe('resolveWebDist', () => {
  it('resolves apps/web/dist from the server package root', () => {
    const fromSrc = pathToFileURL(path.join(process.cwd(), 'src', 'paths.ts')).href;
    expect(resolveWebDist(fromSrc)).toBe(path.resolve(process.cwd(), '../web/dist'));
  });

  it('uses import.meta.url when no module url is passed', () => {
    expect(resolveWebDist()).toBe(path.resolve(process.cwd(), '../web/dist'));
  });
});
