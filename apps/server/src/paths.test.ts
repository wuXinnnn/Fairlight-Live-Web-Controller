import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveConfigPath, resolveDataDir, resolveRuntimePaths, resolveWebDist } from './paths.js';

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
    expect(resolveConfigPath('/tmp/flwc-config', fromSrc)).toBe(
      path.join('/tmp/flwc-config', 'config.json'),
    );
  });

  it('uses import.meta.url when no module url is passed', () => {
    expect(resolveDataDir()).toBe(path.resolve(process.cwd(), '../../data'));
    expect(resolveConfigPath()).toBe(path.resolve(process.cwd(), '../../data/config.json'));
  });
});

describe('resolveRuntimePaths', () => {
  const fromSrc = pathToFileURL(path.join(process.cwd(), 'src', 'paths.ts')).href;

  it('falls back to the repo-relative defaults when neither variable is set', () => {
    expect(resolveRuntimePaths({}, fromSrc)).toEqual({
      webRoot: resolveWebDist(fromSrc),
      dataDir: resolveDataDir(fromSrc),
      configPath: resolveConfigPath(undefined, fromSrc),
    });
  });

  it('uses both overrides, and puts config.json inside the data directory', () => {
    const paths = resolveRuntimePaths(
      { FLWC_WEB_ROOT: 'web-elsewhere', FLWC_DATA_DIR: 'data-elsewhere' },
      fromSrc,
    );
    expect(paths.webRoot).toBe(path.resolve('web-elsewhere'));
    expect(paths.dataDir).toBe(path.resolve('data-elsewhere'));
    expect(paths.configPath).toBe(path.join(path.resolve('data-elsewhere'), 'config.json'));
  });

  it('overrides each one on its own', () => {
    const webOnly = resolveRuntimePaths({ FLWC_WEB_ROOT: 'web-elsewhere' }, fromSrc);
    expect(webOnly.webRoot).toBe(path.resolve('web-elsewhere'));
    expect(webOnly.dataDir).toBe(resolveDataDir(fromSrc));

    const dataOnly = resolveRuntimePaths({ FLWC_DATA_DIR: 'data-elsewhere' }, fromSrc);
    expect(dataOnly.webRoot).toBe(resolveWebDist(fromSrc));
    expect(dataOnly.dataDir).toBe(path.resolve('data-elsewhere'));
  });

  it('treats a blank variable as unset', () => {
    // An exported-but-empty variable in a shell or a compose file should not silently point the
    // server at its working directory.
    expect(resolveRuntimePaths({ FLWC_WEB_ROOT: '', FLWC_DATA_DIR: '   ' }, fromSrc)).toEqual(
      resolveRuntimePaths({}, fromSrc),
    );
  });
});
