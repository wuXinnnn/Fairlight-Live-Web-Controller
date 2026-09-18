import { describe, expect, it } from 'vitest';
import {
  parseDumpTreeArgs,
  parseFlagArgs,
  parseMockProviderArgs,
  parseVerifyEmberArgs,
  parseBrowserArgs,
  parseSoakArgs,
  SOAK_DEFAULT_MINUTES,
} from './cli-args.js';

describe('parseFlagArgs', () => {
  it('parses string flags and bare booleans', () => {
    expect(parseFlagArgs(['--host', '127.0.0.1', '--i-confirm', '--out', 'dump.json'])).toEqual({
      host: '127.0.0.1',
      'i-confirm': true,
      out: 'dump.json',
    });
  });

  it('ignores tokens that are not flags', () => {
    expect(parseFlagArgs(['dump-tree', '--port', '9000'])).toEqual({ port: '9000' });
  });
});

describe('parseDumpTreeArgs', () => {
  it('requires host, port, and out', () => {
    expect(
      parseDumpTreeArgs([
        '--host',
        '127.0.0.1',
        '--port',
        '9000',
        '--out',
        'docs/tree-dumps/x.json',
      ]),
    ).toEqual({
      host: '127.0.0.1',
      port: 9000,
      out: 'docs/tree-dumps/x.json',
      timeoutMs: 10_000,
    });
  });

  it('rejects a missing host', () => {
    expect(() => parseDumpTreeArgs(['--port', '9000', '--out', 'out.json'])).toThrow(
      '--host is required',
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() =>
      parseDumpTreeArgs(['--host', '127.0.0.1', '--port', '0', '--out', 'out.json']),
    ).toThrow('--port must be an integer between 1 and 65535');
  });
});

describe('parseVerifyEmberArgs', () => {
  it('defaults subscribe, delta, and write confirmation', () => {
    expect(parseVerifyEmberArgs(['--host', '127.0.0.1', '--port', '9000'])).toEqual({
      host: '127.0.0.1',
      port: 9000,
      timeoutMs: 10_000,
      subscribeMs: 8000,
      channel: undefined,
      deltaDb: 1,
      confirmWrite: false,
    });
  });

  it('parses optional write flags', () => {
    expect(
      parseVerifyEmberArgs([
        '--host',
        '127.0.0.1',
        '--port',
        '9000',
        '--channel',
        'Anagram-Dry',
        '--delta-db',
        '-1',
        '--i-confirm',
      ]),
    ).toMatchObject({
      channel: 'Anagram-Dry',
      deltaDb: -1,
      confirmWrite: true,
    });
  });

  it('rejects a zero delta', () => {
    expect(() =>
      parseVerifyEmberArgs(['--host', '127.0.0.1', '--port', '9000', '--delta-db', '0']),
    ).toThrow('--delta-db must be a non-zero number');
  });
});

describe('parseBrowserArgs', () => {
  it('takes a value that begins with a dash, because every browser flag does', () => {
    /*
     * What the process actually sees once a shell has removed the quotes from
     * `--browser-args "--no-sandbox"`. Reading it through the generic flag parser would see the
     * next `--` and call this flag valueless, which is how a CI run of the soak workflow failed.
     */
    expect(parseBrowserArgs(['--minutes', '3', '--browser-args', '--no-sandbox'])).toEqual([
      '--no-sandbox',
    ]);
  });

  it('splits several arguments the caller grouped into one token', () => {
    expect(parseBrowserArgs(['--browser-args', '--no-sandbox --disable-gpu'])).toEqual([
      '--no-sandbox',
      '--disable-gpu',
    ]);
  });

  it('is empty when the flag is absent', () => {
    expect(parseBrowserArgs(['--minutes', '3'])).toEqual([]);
  });

  it('refuses the flag with nothing after it at all', () => {
    expect(() => parseBrowserArgs(['--browser-args'])).toThrow('--browser-args needs a value');
  });
});

describe('parseSoakArgs', () => {
  it('falls back to the tuned defaults', () => {
    const args = parseSoakArgs([]);
    expect(args.minutes).toBe(SOAK_DEFAULT_MINUTES);
    expect(args.browserArgs).toEqual([]);
    expect(args.url).toBeUndefined();
  });

  it('reads the flags the workflow passes', () => {
    const args = parseSoakArgs([
      '--minutes',
      '3',
      '--browser',
      '/usr/bin/google-chrome',
      '--browser-args',
      '--no-sandbox',
      '--out',
      'soak-reports/ci',
    ]);
    expect(args.minutes).toBe(3);
    expect(args.browser).toBe('/usr/bin/google-chrome');
    expect(args.browserArgs).toEqual(['--no-sandbox']);
    expect(args.out).toBe('soak-reports/ci');
  });

  it('allows churn to be turned off but not the intervals that must tick', () => {
    expect(parseSoakArgs(['--churn-minutes', '0']).churnMinutes).toBe(0);
    expect(() => parseSoakArgs(['--minutes', '0'])).toThrow(/positive number/);
    expect(() => parseSoakArgs(['--sample-seconds', 'soon'])).toThrow(/positive number/);
  });

  it('refuses a flag given without a value', () => {
    expect(() => parseSoakArgs(['--minutes'])).toThrow('--minutes needs a value');
    expect(() => parseSoakArgs(['--out'])).toThrow('--out needs a value');
  });
});

describe('parseMockProviderArgs', () => {
  it('needs a port and otherwise listens on every interface with the latest dump', () => {
    expect(parseMockProviderArgs(['--port', '9100'])).toEqual({
      host: '0.0.0.0',
      port: 9100,
      dump: undefined,
      meters: false,
    });
  });

  it('takes a host, a dump and the meter feed', () => {
    expect(
      parseMockProviderArgs([
        '--port',
        '9100',
        '--host',
        '127.0.0.1',
        '--dump',
        'docs/tree-dumps/fairlight-live-2026-08-31.json',
        '--meters',
      ]),
    ).toEqual({
      host: '127.0.0.1',
      port: 9100,
      dump: 'docs/tree-dumps/fairlight-live-2026-08-31.json',
      meters: true,
    });
  });

  it('refuses a missing or unusable port', () => {
    expect(() => parseMockProviderArgs([])).toThrow('--port is required');
    expect(() => parseMockProviderArgs(['--port'])).toThrow('--port is required');
    expect(() => parseMockProviderArgs(['--port', '0'])).toThrow(
      '--port must be an integer between 1 and 65535',
    );
  });
});
