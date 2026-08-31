import { describe, expect, it } from 'vitest';
import { parseDumpTreeArgs, parseFlagArgs, parseVerifyEmberArgs } from './cli-args.js';

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
