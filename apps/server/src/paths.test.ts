import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveConfigPath, resolveDataDir, resolveWebDist } from './paths.js';

describe('resolveWebDist', () => {
  it('resolves apps/web/dist from the server package root', () => {
    const fromSrc = pathToFileURL(path.join(process.cwd(), 'src', 'paths.ts')).href;
    expect(resolveWebDist(fromSrc)).toBe(path.resolve(process.cwd(), '../web/dist'));
  });

  it('uses import.meta.url when no module url is passed', () => {
    expect(resolveWebDist()).toBe(path.resolve(process.cwd(), '../web/dist'));
  });
});

describe('resolveDataDir and resolveConfigPath', () => {
  it('resolves the repo data directory and config.json', () => {
    const fromSrc = pathToFileURL(path.join(process.cwd(), 'src', 'paths.ts')).href;
    expect(resolveDataDir(fromSrc)).toBe(path.resolve(process.cwd(), '../../data'));
    expect(resolveConfigPath(undefined, fromSrc)).toBe(
      path.resolve(process.cwd(), '../../data/config.json'),
    );
    expect(resolveConfigPath('/tmp/flwc-config', fromSrc)).toBe('/tmp/flwc-config/config.json');
  });

  it('uses import.meta.url when no module url is passed', () => {
    expect(resolveDataDir()).toBe(path.resolve(process.cwd(), '../../data'));
    expect(resolveConfigPath()).toBe(path.resolve(process.cwd(), '../../data/config.json'));
  });
});
