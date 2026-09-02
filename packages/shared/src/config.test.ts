import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  CHANNEL_PALETTE_KEYS,
  defaultAppConfig,
  DEFAULT_EMBER_HOST,
  DEFAULT_EMBER_PORT,
  viewChannelRefSchema,
  viewSchema,
} from './config.js';
import { connectionGetResponseSchema, connectionPutBodySchema } from './connection.js';
import { apiErrorSchema, ERROR_CODES } from './errors.js';
import { SOCKET_EVENTS } from './events.js';
import { viewsListResponseSchema, viewWriteBodySchema } from './views.js';

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

  it('accepts a config with kind and name channel references and groups', () => {
    const config = {
      version: 1 as const,
      ember: { host: '10.0.0.8', port: 9001 },
      views: [
        {
          id: 'foh',
          name: 'FOH',
          channels: [
            { kind: 'channel' as const, name: 'BASS', channelId: 'channel/3', groupId: 'rhythm' },
            { kind: 'aux' as const, name: 'FX', color: 'lime' as const },
          ],
          groups: [{ id: 'rhythm', name: 'Rhythm' }],
        },
      ],
    };
    expect(appConfigSchema.parse(config)).toEqual(config);
    expect(viewSchema.parse(config.views[0])).toEqual(config.views[0]);
  });

  it('defaults groups to an empty list', () => {
    expect(viewSchema.parse({ id: 'foh', name: 'FOH', channels: [] })).toEqual({
      id: 'foh',
      name: 'FOH',
      channels: [],
      groups: [],
    });
  });

  it('migrates legacy channelId and lastKnownName references', () => {
    expect(CHANNEL_PALETTE_KEYS).toEqual(['green', 'red', 'teal', 'navy', 'lime', 'purple']);
    expect(
      viewChannelRefSchema.parse({
        channelId: 'aux/3',
        lastKnownName: 'FX',
        color: 'lime',
      }),
    ).toEqual({ kind: 'aux', name: 'FX', channelId: 'aux/3', color: 'lime' });
    expect(
      viewChannelRefSchema.parse({
        channelId: 'channel/3',
        lastKnownName: 'BASS',
      }),
    ).toEqual({ kind: 'channel', name: 'BASS', channelId: 'channel/3' });
    expect(viewChannelRefSchema.parse({ channelId: 'legacy', lastKnownName: 'Odd' })).toEqual({
      kind: 'channel',
      name: 'Odd',
      channelId: 'legacy',
    });
  });

  it('passes new-shape and malformed references through to the object schema', () => {
    const reference = { kind: 'main' as const, name: 'Main', channelId: 'main/1' };
    expect(viewChannelRefSchema.parse(reference)).toEqual(reference);
    expect(viewChannelRefSchema.parse({ ...reference, lastKnownName: 'Ignored' })).toEqual(
      reference,
    );
    expect(() => viewChannelRefSchema.parse({ lastKnownName: 'BASS' })).toThrow();
    expect(() => viewChannelRefSchema.parse({ kind: 'channel', name: ' ' })).toThrow();
    expect(() => viewChannelRefSchema.parse({ kind: 'strip', name: 'BASS' })).toThrow();
    expect(() => viewChannelRefSchema.parse('channel/3')).toThrow();
    expect(() => viewChannelRefSchema.parse(null)).toThrow();
  });

  it('validates view write payloads and list responses', () => {
    const body = {
      name: '  Broadcast  ',
      channels: [
        { kind: 'main' as const, name: 'Main', channelId: 'main/1', color: 'red' as const },
      ],
      groups: [],
    };
    expect(viewWriteBodySchema.parse(body)).toEqual({
      ...body,
      name: 'Broadcast',
    });
    expect(viewsListResponseSchema.parse([{ id: 'broadcast', ...body }])).toEqual([
      { id: 'broadcast', ...body, name: 'Broadcast' },
    ]);
    expect(() => viewWriteBodySchema.parse({ name: ' ', channels: [] })).toThrow();
    expect(() =>
      viewWriteBodySchema.parse({
        name: 'Broadcast',
        channels: [{ kind: 'main', name: 'Main', color: 'orange' }],
      }),
    ).toThrow();
  });

  it('rejects dangling group references and duplicate group ids', () => {
    expect(() =>
      viewWriteBodySchema.parse({
        name: 'Broadcast',
        channels: [{ kind: 'channel', name: 'BASS', groupId: 'missing' }],
        groups: [],
      }),
    ).toThrow(/Unknown group id/);
    expect(() =>
      viewSchema.parse({
        id: 'broadcast',
        name: 'Broadcast',
        channels: [],
        groups: [
          { id: 'g1', name: 'Rhythm' },
          { id: 'g1', name: 'Vocals' },
        ],
      }),
    ).toThrow(/Duplicate group id/);
    expect(() =>
      viewSchema.parse({
        id: 'broadcast',
        name: 'Broadcast',
        channels: [],
        groups: [{ id: 'g1', name: ' ' }],
      }),
    ).toThrow();
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
