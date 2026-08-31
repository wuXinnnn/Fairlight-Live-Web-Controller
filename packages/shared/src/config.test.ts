import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  defaultAppConfig,
  DEFAULT_EMBER_HOST,
  DEFAULT_EMBER_PORT,
  viewSchema,
} from './config.js';
import { connectionGetResponseSchema, connectionPutBodySchema } from './connection.js';
import { apiErrorSchema, ERROR_CODES } from './errors.js';
import { SOCKET_EVENTS } from './events.js';

describe('config and connection schemas', () => {
  it('returns the documented default config', () => {
    const config = defaultAppConfig();
    expect(config).toEqual({
      version: 1,
      ember: { host: DEFAULT_EMBER_HOST, port: DEFAULT_EMBER_PORT },
      views: [],
    });
    expect(appConfigSchema.parse(config)).toEqual(config);
  });

  it('accepts a config that includes views for forward compatibility', () => {
    const config = {
      version: 1 as const,
      ember: { host: '10.0.0.8', port: 9001 },
      views: [
        {
          id: 'foh',
          name: 'FOH',
          channels: [{ channelId: 'channel/3', lastKnownName: 'BASS' }],
        },
      ],
    };
    expect(appConfigSchema.parse(config)).toEqual(config);
    expect(viewSchema.parse(config.views[0])).toEqual(config.views[0]);
  });

  it('rejects an invalid port or version', () => {
    expect(() => appConfigSchema.parse({ ...defaultAppConfig(), version: 2 })).toThrow();
    expect(() => connectionPutBodySchema.parse({ host: '127.0.0.1', port: 0 })).toThrow();
    expect(() => connectionPutBodySchema.parse({ host: '', port: 9000 })).toThrow();
  });

  it('parses connection GET payloads and API errors', () => {
    expect(
      connectionGetResponseSchema.parse({ host: '127.0.0.1', port: 9000, status: 'disconnected' }),
    ).toMatchObject({ status: 'disconnected' });
    expect(
      apiErrorSchema.parse({ error: { code: ERROR_CODES.VALIDATION, message: 'bad' } }),
    ).toEqual({
      error: { code: 'VALIDATION', message: 'bad' },
    });
  });

  it('exposes the architecture event names', () => {
    expect(SOCKET_EVENTS).toEqual({
      MIXER_SNAPSHOT: 'mixer:snapshot',
      MIXER_PATCH: 'mixer:patch',
      METERS_FRAME: 'meters:frame',
      SYSTEM_STATUS: 'system:status',
      CONTROL_SET_LEVEL: 'control:set-level',
      CONTROL_SET_ON: 'control:set-on',
      CONTROL_RESET_LOUDNESS: 'control:reset-loudness',
    });
  });
});
