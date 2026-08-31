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
