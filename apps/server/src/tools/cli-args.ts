/** How long a soak run lasts unless told otherwise. */
export const SOAK_DEFAULT_MINUTES = 60;
/** How often every counter is read. */
export const SOAK_SAMPLE_INTERVAL_S = 30;
/** How often the operator turns a page. */
export const SOAK_PAGE_TURN_INTERVAL_S = 5;
/** How often a connection is pulled out, alternating between Ember and the socket. */
export const SOAK_CHURN_INTERVAL_MINUTES = 10;
/** How fast the desk is fed levels. */
export const SOAK_METER_HZ = 20;

export interface DumpTreeArgs {
  host: string;
  port: number;
  out: string;
  timeoutMs: number;
}

export interface VerifyEmberArgs {
  host: string;
  port: number;
  timeoutMs: number;
  subscribeMs: number;
  channel?: string;
  deltaDb: number;
  confirmWrite: boolean;
}

export interface SoakArgs {
  minutes: number;
  sampleSeconds: number;
  pageSeconds: number;
  churnMinutes: number;
  meterHz: number;
  browser?: string;
  browserArgs: string[];
  out?: string;
  url?: string;
  dump?: string;
}

export function parseFlagArgs(argv: string[]): Record<string, string | true> {
  const result: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    if (key === '') {
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function requireString(flags: Record<string, string | true>, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }
  return port;
}

function parsePositiveInt(
  value: string | true | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`--${name} requires a number`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

export function parseDumpTreeArgs(argv: string[]): DumpTreeArgs {
  const flags = parseFlagArgs(argv);
  return {
    host: requireString(flags, 'host'),
    port: parsePort(requireString(flags, 'port')),
    out: requireString(flags, 'out'),
    timeoutMs: parsePositiveInt(flags['timeout-ms'], 'timeout-ms', 10_000),
  };
}

export function parseVerifyEmberArgs(argv: string[]): VerifyEmberArgs {
  const flags = parseFlagArgs(argv);
  const channel = flags.channel;
  return {
    host: requireString(flags, 'host'),
    port: parsePort(requireString(flags, 'port')),
    timeoutMs: parsePositiveInt(flags['timeout-ms'], 'timeout-ms', 10_000),
    subscribeMs: parsePositiveInt(flags['subscribe-ms'], 'subscribe-ms', 8000),
    channel: typeof channel === 'string' ? channel : undefined,
    deltaDb: parseDeltaDb(flags['delta-db']),
    confirmWrite: flags['i-confirm'] === true,
  };
}

function parseDeltaDb(value: string | true | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== 'string') {
    throw new Error('--delta-db requires a number');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) {
    throw new Error('--delta-db must be a non-zero number');
  }
  return parsed;
}

function soakNumber(
  flags: Record<string, string | true>,
  name: string,
  fallback: number,
  { allowZero = false } = {},
): number {
  const raw = flags[name];
  if (raw === undefined) {
    return fallback;
  }
  if (raw === true) {
    throw new Error(`--${name} needs a value`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value <= 0)) {
    throw new Error(`--${name} must be a positive number, got '${raw}'`);
  }
  return value;
}

function soakString(flags: Record<string, string | true>, name: string): string | undefined {
  const raw = flags[name];
  if (raw === undefined) {
    return undefined;
  }
  if (raw === true) {
    throw new Error(`--${name} needs a value`);
  }
  return raw;
}

/**
 * The browser arguments, read by position rather than through `parseFlagArgs`.
 *
 * Every browser flag begins with `--`, and `parseFlagArgs` treats a value that begins with `--` as
 * the next flag rather than as this one's value. A shell has usually removed the quotes by the
 * time the process sees them, so `--browser-args "--no-sandbox"` arrives as two plain tokens and
 * would otherwise be read as a flag with nothing after it. Several arguments still arrive as one
 * space-separated token, because the quotes that group them are the caller's own.
 */
export function parseBrowserArgs(argv: string[]): string[] {
  const at = argv.lastIndexOf('--browser-args');
  if (at === -1) {
    return [];
  }
  const value = argv[at + 1];
  if (value === undefined) {
    throw new Error('--browser-args needs a value');
  }
  return value.split(' ').filter(Boolean);
}

export function parseSoakArgs(argv: string[]): SoakArgs {
  const flags = parseFlagArgs(argv);
  return {
    minutes: soakNumber(flags, 'minutes', SOAK_DEFAULT_MINUTES),
    sampleSeconds: soakNumber(flags, 'sample-seconds', SOAK_SAMPLE_INTERVAL_S),
    pageSeconds: soakNumber(flags, 'page-seconds', SOAK_PAGE_TURN_INTERVAL_S),
    churnMinutes: soakNumber(flags, 'churn-minutes', SOAK_CHURN_INTERVAL_MINUTES, {
      allowZero: true,
    }),
    meterHz: soakNumber(flags, 'meter-hz', SOAK_METER_HZ),
    browser: soakString(flags, 'browser'),
    browserArgs: parseBrowserArgs(argv),
    out: soakString(flags, 'out'),
    url: soakString(flags, 'url'),
    dump: soakString(flags, 'dump'),
  };
}
