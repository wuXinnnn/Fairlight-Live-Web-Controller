import { describe, expect, it } from 'vitest';
import { parsePortInput, validateEndpoint } from './connection-form.js';

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

  it('reports an empty host', () => {
    expect(validateEndpoint('   ', '9000')).toEqual({
      ok: false,
      errors: { host: 'Enter a host name or IP address.' },
    });
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
  });
});
