import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveWebDist(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../web/dist');
}

export function resolveDataDir(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../../data');
}

export function resolveConfigPath(configDir?: string, moduleUrl: string = import.meta.url): string {
  return path.join(configDir ?? resolveDataDir(moduleUrl), 'config.json');
}

export interface RuntimePaths {
  webRoot: string;
  dataDir: string;
  configPath: string;
}

/**
 * Where the web build and the config file live for this process.
 *
 * The three functions above resolve relative to this module's own location, which is right for a
 * checkout and for the container image, because both keep the repository layout. A desktop
 * launcher cannot: it ships the web build in its resource directory and keeps data in the
 * per-user application data directory, neither of which sits next to the server bundle. These
 * two variables are the way it says so.
 *
 * An empty variable counts as unset, so an exported-but-blank value in a shell or a compose file
 * falls back to the default rather than resolving to the working directory.
 */
export function resolveRuntimePaths(
  env: { FLWC_WEB_ROOT?: string; FLWC_DATA_DIR?: string } = process.env,
  moduleUrl: string = import.meta.url,
): RuntimePaths {
  const webOverride = env.FLWC_WEB_ROOT?.trim();
  const dataOverride = env.FLWC_DATA_DIR?.trim();
  const webRoot =
    webOverride !== undefined && webOverride !== ''
      ? path.resolve(webOverride)
      : resolveWebDist(moduleUrl);
  const dataDir =
    dataOverride !== undefined && dataOverride !== ''
      ? path.resolve(dataOverride)
      : resolveDataDir(moduleUrl);
  return { webRoot, dataDir, configPath: resolveConfigPath(dataDir, moduleUrl) };
}
