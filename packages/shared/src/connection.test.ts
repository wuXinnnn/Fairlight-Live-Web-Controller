import { describe, expect, it } from 'vitest';
import { connectionGetResponseSchema, connectionPutBodySchema } from './connection.js';

describe('connection schemas', () => {
  it('parses a GET response with and without a last error', () => {
    const connected = { host: '10.0.0.8', port: 9000, status: 'connected' as const };
    expect(connectionGetResponseSchema.parse(connected)).toEqual(connected);
    const failing = {
      host: '10.0.0.8',
      port: 9000,
      status: 'connecting' as const,
      lastError: 'connect ECONNREFUSED 10.0.0.8:9000',
    };
    expect(connectionGetResponseSchema.parse(failing)).toEqual(failing);
  });

  it('drops unknown fields and rejects a non-string last error', () => {
    expect(
      connectionGetResponseSchema.parse({
        host: 'mixer.local',
        port: 9000,
        status: 'disconnected',
        extra: true,
      }),
    ).toEqual({ host: 'mixer.local', port: 9000, status: 'disconnected' });
    expect(() =>
      connectionGetResponseSchema.parse({
        host: 'mixer.local',
        port: 9000,
        status: 'disconnected',
        lastError: null,
      }),
    ).toThrow();
  });

  it('validates the PUT body as an ember endpoint', () => {
    expect(connectionPutBodySchema.parse({ host: '10.0.0.8', port: 9000 })).toEqual({
      host: '10.0.0.8',
      port: 9000,
    });
    for (const body of [
      { host: '', port: 9000 },
      { host: '10.0.0.8', port: 0 },
      { host: '10.0.0.8', port: 70000 },
      { host: '10.0.0.8', port: 1.5 },
      { host: '10.0.0.8', port: '9000' },
    ]) {
      expect(connectionPutBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
