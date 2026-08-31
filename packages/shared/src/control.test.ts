import { describe, expect, it } from 'vitest';
import {
  controlAckSchema,
  resetLoudnessCommandSchema,
  setLevelCommandSchema,
  setOnCommandSchema,
} from './control.js';

describe('control schemas', () => {
  it('accepts a level inside the fader range', () => {
    expect(setLevelCommandSchema.parse({ id: 'channel/3', levelDb: -100 })).toEqual({
      id: 'channel/3',
      levelDb: -100,
    });
    expect(setLevelCommandSchema.parse({ id: 'main/1', levelDb: 10 })).toEqual({
      id: 'main/1',
      levelDb: 10,
    });
  });

  it('rejects a level outside the fader range', () => {
    expect(() => setLevelCommandSchema.parse({ id: 'channel/3', levelDb: -100.1 })).toThrow();
    expect(() => setLevelCommandSchema.parse({ id: 'channel/3', levelDb: 10.1 })).toThrow();
  });

  it('rejects a missing channel id', () => {
    expect(() => setLevelCommandSchema.parse({ levelDb: 0 })).toThrow();
    expect(() => setOnCommandSchema.parse({ on: true })).toThrow();
  });

  it('parses set-on and empty reset payloads', () => {
    expect(setOnCommandSchema.parse({ id: 'aux/1', on: false })).toEqual({
      id: 'aux/1',
      on: false,
    });
    expect(resetLoudnessCommandSchema.parse(undefined)).toBeUndefined();
    expect(resetLoudnessCommandSchema.parse(null)).toBeNull();
    expect(resetLoudnessCommandSchema.parse({})).toEqual({});
  });

  it('parses success and failure acks', () => {
    expect(controlAckSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(
      controlAckSchema.parse({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'unknown channel' },
      }),
    ).toMatchObject({ ok: false });
    expect(() => controlAckSchema.parse({ ok: false })).toThrow();
  });
});
