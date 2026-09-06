import { describe, expect, it } from 'vitest';
import { isValidHost, parsePortInput, validateEndpoint } from './connection-form.js';

describe('parsePortInput', () => {
  it('accepts plain digits and rejects everything else', () => {
    expect(parsePortInput('9000')).toBe(9000);
    expect(parsePortInput(' 9000 ')).toBe(9000);
    expect(parsePortInput('1.5')).toBeNaN();
    expect(parsePortInput('abc')).toBeNaN();
    expect(parsePortInput('')).toBeNaN();
    expect(parsePortInput('-1')).toBeNaN();
  });
});

describe('validateEndpoint', () => {
  it('returns a trimmed endpoint for valid input', () => {
    expect(validateEndpoint(' 10.0.0.8 ', ' 9000 ')).toEqual({
      ok: true,
      value: { host: '10.0.0.8', port: 9000 },
    });
  });

  it('reports an empty or malformed host', () => {
    for (const host of [
      '   ',
      '192.168.1',
      '256.1.1.1',
      '192.168.1.10.5',
      'a b',
      'mixer.',
      '-mixer',
    ]) {
      expect(validateEndpoint(host, '9000')).toEqual({
        ok: false,
        errors: { host: 'Enter a valid IP address or host name.' },
      });
    }
  });

  it('accepts IPv4, IPv6, and host names', () => {
    for (const host of [
      '192.168.1.10',
      '10.0.0.8',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'mixer.local',
      'fairlight-01',
      'a.b.c',
    ]) {
      expect(isValidHost(host)).toBe(true);
      expect(validateEndpoint(host, '9000')).toEqual({ ok: true, value: { host, port: 9000 } });
    }
    for (const host of ['1.2.3', '1.2.3.4.5', '999.1.1.1', ':::', '1:2:3:4:5:6:7:8:9', 'x_y']) {
      expect(isValidHost(host)).toBe(false);
    }
  });

  it.each(['0', '70000', '1.5', 'abc', ''])('reports port %j as out of range', (port) => {
    expect(validateEndpoint('10.0.0.8', port)).toEqual({
      ok: false,
      errors: { port: 'Port must be a whole number between 1 and 65535.' },
    });
  });

  it('reports both fields at once', () => {
    const result = validateEndpoint('', '0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.host).toBeDefined();
      expect(result.errors.port).toBeDefined();
    }
    // A malformed host with a valid port reports only the host.
    expect(validateEndpoint('192.168.1', '9000')).toEqual({
      ok: false,
      errors: { host: 'Enter a valid IP address or host name.' },
    });
  });
});
