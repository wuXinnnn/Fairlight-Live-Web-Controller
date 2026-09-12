import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  CHANNEL_PALETTE_KEYS,
  defaultAppConfig,
  DEFAULT_EMBER_HOST,
  DEFAULT_EMBER_PORT,
  migrateAppConfig,
  viewChannelRefs,
  viewChannelRefSchema,
  viewGroups,
  viewSchema,
  type AppConfig,
} from './config.js';
import { connectionGetResponseSchema, connectionPutBodySchema } from './connection.js';
import { apiErrorSchema, ERROR_CODES } from './errors.js';
import { SOCKET_EVENTS } from './events.js';
import { viewsListResponseSchema, viewWriteBodySchema } from './views.js';

/** A version 1 config, the shape `migrateAppConfig` has to bring forward. */
function legacyConfig(view: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    ember: { host: DEFAULT_EMBER_HOST, port: DEFAULT_EMBER_PORT },
    views: [{ id: 'v', name: 'V', ...view }],
  };
}

function migratedItems(view: Record<string, unknown>): unknown {
  const config = migrateAppConfig(legacyConfig(view)) as {
    views: { items: unknown }[];
  };
  return config.views[0]?.items;
}

describe('config and connection schemas', () => {
  it('returns the documented default config', () => {
    const config = defaultAppConfig();
    expect(config).toEqual({
      version: 2,
      ember: { host: DEFAULT_EMBER_HOST, port: DEFAULT_EMBER_PORT },
      views: [],
    });
    expect(appConfigSchema.parse(config)).toEqual(config);
  });

  it('accepts a config whose views are ordered channel and group items', () => {
    const config: AppConfig = {
      version: 2,
      ember: { host: '10.0.0.8', port: 9001 },
      views: [
        {
          id: 'foh',
          name: 'FOH',
          items: [
            {
              type: 'group',
              id: 'rhythm',
              name: 'Rhythm',
              channels: [{ kind: 'channel', name: 'BASS', channelId: 'channel/3' }],
            },
            { type: 'channel', kind: 'aux', name: 'FX', color: 'lime' },
          ],
        },
      ],
    };
    expect(appConfigSchema.parse(config)).toEqual(config);
    expect(viewSchema.parse(config.views[0])).toEqual(config.views[0]);
  });

  it('defaults items to an empty list', () => {
    expect(viewSchema.parse({ id: 'foh', name: 'FOH' })).toEqual({
      id: 'foh',
      name: 'FOH',
      items: [],
    });
  });

  it('flattens and lists the items of a view', () => {
    const view = viewSchema.parse({
      id: 'v',
      name: 'V',
      items: [
        { type: 'channel', kind: 'main', name: 'Main' },
        {
          type: 'group',
          id: 'g1',
          name: 'Rhythm',
          channels: [
            { kind: 'channel', name: 'BASS' },
            { kind: 'channel', name: 'GTR' },
          ],
        },
        { type: 'group', id: 'g2', name: 'Empty', channels: [] },
        { type: 'channel', kind: 'aux', name: 'FX' },
      ],
    });
    // Display order, root entries and members alike.
    expect(viewChannelRefs(view).map((reference) => reference.name)).toEqual([
      'Main',
      'BASS',
      'GTR',
      'FX',
    ]);
    expect(viewGroups(view).map((group) => group.id)).toEqual(['g1', 'g2']);
    expect(viewChannelRefs({ items: [] })).toEqual([]);
    expect(viewGroups({ items: [] })).toEqual([]);
  });

  it('validates channel references and rejects malformed ones', () => {
    expect(CHANNEL_PALETTE_KEYS).toEqual(['green', 'red', 'teal', 'navy', 'lime', 'purple']);
    const reference = { kind: 'main' as const, name: 'Main', channelId: 'main/1' };
    expect(viewChannelRefSchema.parse(reference)).toEqual(reference);
    expect(() => viewChannelRefSchema.parse({ lastKnownName: 'BASS' })).toThrow();
    expect(() => viewChannelRefSchema.parse({ kind: 'channel', name: ' ' })).toThrow();
    expect(() => viewChannelRefSchema.parse({ kind: 'strip', name: 'BASS' })).toThrow();
    expect(() => viewChannelRefSchema.parse('channel/3')).toThrow();
    expect(() => viewChannelRefSchema.parse(null)).toThrow();
  });

  it('validates view write payloads and list responses', () => {
    const body = {
      name: '  Broadcast  ',
      items: [
        { type: 'channel' as const, kind: 'main' as const, name: 'Main', channelId: 'main/1' },
        { type: 'group' as const, id: 'g1', name: 'Buses', channels: [] },
      ],
    };
    expect(viewWriteBodySchema.parse(body)).toEqual({ ...body, name: 'Broadcast' });
    expect(viewsListResponseSchema.parse([{ id: 'broadcast', ...body }])).toEqual([
      { id: 'broadcast', ...body, name: 'Broadcast' },
    ]);
    expect(() => viewWriteBodySchema.parse({ name: ' ', items: [] })).toThrow();
    expect(() =>
      viewWriteBodySchema.parse({
        name: 'Broadcast',
        items: [{ type: 'channel', kind: 'main', name: 'Main', color: 'orange' }],
      }),
    ).toThrow();
    // An item has to say which kind it is.
    expect(() =>
      viewWriteBodySchema.parse({ name: 'Broadcast', items: [{ kind: 'main', name: 'Main' }] }),
    ).toThrow();
  });

  it('accepts group colours and only lets a grouped channel follow one', () => {
    const view = {
      id: 'v1',
      name: 'FOH',
      items: [
        {
          type: 'group',
          id: 'g1',
          name: 'Rhythm',
          color: 'teal',
          channels: [{ kind: 'channel', name: 'BASS', color: 'group' }],
        },
        { type: 'channel', kind: 'main', name: 'Main', color: 'purple' },
        { type: 'channel', kind: 'aux', name: 'FX' },
      ],
    };
    const parsed = viewSchema.parse(view);
    expect(viewGroups(parsed)[0]?.color).toBe('teal');
    expect(viewChannelRefs(parsed)[0]?.color).toBe('group');
    expect(viewChannelRefs(parsed)[2]?.color).toBeUndefined();

    // A group without a colour is still valid; it takes one from its members' types.
    const plainGroup = { type: 'group', id: 'g1', name: 'Rhythm', channels: [] };
    expect(() => viewSchema.parse({ ...view, items: [plainGroup] })).not.toThrow();
    // Palette keys are still an enum on both sides.
    expect(() =>
      viewSchema.parse({ ...view, items: [{ ...plainGroup, color: 'group' }] }),
    ).toThrow();
    expect(() =>
      viewSchema.parse({
        ...view,
        items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'mauve' }],
      }),
    ).toThrow();

    // "group" outside a group has nothing to follow.
    expect(() =>
      viewSchema.parse({
        ...view,
        items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'group' }],
      }),
    ).toThrow(/Channel color .+ requires a group/);
    // The write body runs the same refinement.
    expect(() =>
      viewWriteBodySchema.parse({
        name: 'FOH',
        items: [{ type: 'channel', kind: 'channel', name: 'BASS', color: 'group' }],
      }),
    ).toThrow(/Channel color .+ requires a group/);
  });

  it('rejects duplicate group ids and unnamed groups', () => {
    expect(() =>
      viewSchema.parse({
        id: 'broadcast',
        name: 'Broadcast',
        items: [
          { type: 'group', id: 'g1', name: 'Rhythm', channels: [] },
          { type: 'group', id: 'g1', name: 'Vocals', channels: [] },
        ],
      }),
    ).toThrow(/Duplicate group id/);
    expect(() =>
      viewSchema.parse({
        id: 'broadcast',
        name: 'Broadcast',
        items: [{ type: 'group', id: 'g1', name: ' ', channels: [] }],
      }),
    ).toThrow();
  });

  it('rejects an invalid port or version', () => {
    expect(() => appConfigSchema.parse({ ...defaultAppConfig(), version: 3 })).toThrow();
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

describe('migrateAppConfig', () => {
  it('gathers each run of group members into one block, in place', () => {
    expect(
      migratedItems({
        channels: [
          { kind: 'main', name: 'Main' },
          { kind: 'channel', name: 'BASS', groupId: 'g1' },
          { kind: 'channel', name: 'GTR', groupId: 'g1' },
          { kind: 'aux', name: 'FX' },
        ],
        groups: [{ id: 'g1', name: 'Rhythm', color: 'teal' }],
      }),
    ).toEqual([
      { type: 'channel', kind: 'main', name: 'Main' },
      {
        type: 'group',
        id: 'g1',
        name: 'Rhythm',
        color: 'teal',
        channels: [
          { kind: 'channel', name: 'BASS' },
          { kind: 'channel', name: 'GTR' },
        ],
      },
      { type: 'channel', kind: 'aux', name: 'FX' },
    ]);
  });

  it('splits a group whose members were not next to each other, giving each block an id', () => {
    // Version 1 never required contiguity and the mixer drew such a group as two sections.
    const items = migratedItems({
      channels: [
        { kind: 'channel', name: 'BASS', groupId: 'g1' },
        { kind: 'main', name: 'Main' },
        { kind: 'channel', name: 'GTR', groupId: 'g1' },
      ],
      groups: [{ id: 'g1', name: 'Rhythm' }],
    }) as { type: string; id?: string; groupId?: string; channels?: { name: string }[] }[];
    expect(items.map((item) => item.type)).toEqual(['group', 'channel', 'group']);
    expect(items[0]?.channels?.map((c) => c.name)).toEqual(['BASS']);
    expect(items[2]?.channels?.map((c) => c.name)).toEqual(['GTR']);
    // Two blocks cannot share an id: the second run gets one of its own, and the bookkeeping
    // key the migration used to pair them up does not leak into the result.
    expect(items[0]?.id).toBe('g1');
    expect(items[2]?.id).toBe('g1-2');
    expect(items.every((item) => item.groupId === undefined)).toBe(true);
  });

  it('keeps a split group clear of ids the file already uses', () => {
    const items = migratedItems({
      channels: [
        { kind: 'channel', name: 'A', groupId: 'g1' },
        { kind: 'main', name: 'Main' },
        { kind: 'channel', name: 'B', groupId: 'g1' },
        { kind: 'sub', name: 'Sub' },
        { kind: 'channel', name: 'C', groupId: 'g1' },
      ],
      groups: [
        { id: 'g1', name: 'Rhythm' },
        // A group already called g1-2 would collide with the obvious choice of name.
        { id: 'g1-2', name: 'Decoy' },
      ],
    }) as { id?: string }[];
    expect(items.map((item) => item.id)).toEqual([
      'g1',
      undefined,
      'g1-3',
      undefined,
      'g1-4',
      'g1-2',
    ]);
  });

  it('never migrates a version 1 config into one the schema would throw away', () => {
    // A duplicate id fails the refinement, and ConfigStore answers that by replacing the whole
    // file with defaults - every view and the Ember endpoint with it.
    const parsed = appConfigSchema.safeParse(
      legacyConfig({
        channels: [
          { kind: 'channel', name: 'BASS', groupId: 'g1' },
          { kind: 'main', name: 'Main' },
          { kind: 'channel', name: 'GTR', groupId: 'g1' },
        ],
        groups: [{ id: 'g1', name: 'Rhythm' }],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('appends groups nobody referenced, in their stored order', () => {
    expect(
      migratedItems({
        channels: [{ kind: 'main', name: 'Main' }],
        groups: [
          { id: 'g1', name: 'First' },
          { id: 'g2', name: 'Second' },
        ],
      }),
    ).toEqual([
      { type: 'channel', kind: 'main', name: 'Main' },
      { type: 'group', id: 'g1', name: 'First', channels: [] },
      { type: 'group', id: 'g2', name: 'Second', channels: [] },
    ]);
  });

  it('treats a groupId that points at nothing as no group at all', () => {
    expect(
      migratedItems({
        channels: [{ kind: 'channel', name: 'BASS', groupId: 'ghost' }],
        groups: [],
      }),
    ).toEqual([{ type: 'channel', kind: 'channel', name: 'BASS' }]);
  });

  it('brings the pre-grouping reference shape forward on the way', () => {
    expect(
      migratedItems({
        channels: [
          { channelId: 'aux/3', lastKnownName: 'FX', color: 'lime' },
          { channelId: 'channel/3', lastKnownName: 'BASS' },
          { channelId: 'legacy', lastKnownName: 'Odd' },
          { channelId: 'main/1', lastKnownName: '   ' },
          { kind: 'sub', name: 'SUB', lastKnownName: 'Ignored' },
          { channelId: 'mtx/2', lastKnownName: 'Aux Matrix', groupId: 'g1' },
        ],
        groups: [{ id: 'g1', name: 'Sends' }],
      }),
    ).toEqual([
      { type: 'channel', kind: 'aux', name: 'FX', channelId: 'aux/3', color: 'lime' },
      { type: 'channel', kind: 'channel', name: 'BASS', channelId: 'channel/3' },
      // An unknown id prefix falls back to an input channel...
      { type: 'channel', kind: 'channel', name: 'Odd', channelId: 'legacy' },
      // ...and an empty name falls back to the id, so one bad entry cannot void the file.
      { type: 'channel', kind: 'main', name: 'main/1', channelId: 'main/1' },
      // A reference already in the new shape is left alone, stray keys and all.
      { type: 'channel', kind: 'sub', name: 'SUB', lastKnownName: 'Ignored' },
      // Rebuilding the reference must not drop the group it named.
      {
        type: 'group',
        id: 'g1',
        name: 'Sends',
        channels: [{ kind: 'mtx', name: 'Aux Matrix', channelId: 'mtx/2' }],
      },
    ]);
    expect(
      appConfigSchema.safeParse(
        legacyConfig({ channels: [{ channelId: 'aux/2', lastKnownName: '' }] }),
      ).success,
    ).toBe(true);
  });

  it('keeps a member set to follow its group colour', () => {
    expect(
      migratedItems({
        channels: [{ kind: 'channel', name: 'BASS', groupId: 'g1', color: 'group' }],
        groups: [{ id: 'g1', name: 'Rhythm' }],
      }),
    ).toEqual([
      {
        type: 'group',
        id: 'g1',
        name: 'Rhythm',
        channels: [{ kind: 'channel', name: 'BASS', color: 'group' }],
      },
    ]);
  });

  it('reads a whole version 1 file into a version 2 config', () => {
    const parsed = appConfigSchema.parse(
      legacyConfig({
        channels: [
          { kind: 'channel', name: 'BASS', groupId: 'g1' },
          { kind: 'main', name: 'Main' },
        ],
        groups: [
          { id: 'g1', name: 'Rhythm' },
          { id: 'g2', name: 'Spare' },
        ],
      }),
    );
    expect(parsed.version).toBe(2);
    expect(parsed.views[0]?.items.map((item) => item.type)).toEqual(['group', 'channel', 'group']);
  });

  it('leaves version 2 alone and passes any other version through to be rejected', () => {
    const current = defaultAppConfig();
    expect(migrateAppConfig(current)).toEqual(current);
    expect(migrateAppConfig({ version: 3, ember: null, views: [] })).toEqual({
      version: 3,
      ember: null,
      views: [],
    });
    expect(migrateAppConfig(null)).toBeNull();
    expect(migrateAppConfig('nonsense')).toBe('nonsense');
    // A version 1 file with nothing usable in it still comes out shaped like version 2.
    expect(migrateAppConfig({ version: 1 })).toEqual({ version: 2, views: [] });
    // Junk where a view, a group or a channel list should be is handed to the schema to reject
    // rather than crashing the read, because a config that will not parse falls back to defaults.
    expect(migrateAppConfig({ version: 1, views: [null, 'nope', { id: 'v', name: 'V' }] })).toEqual(
      {
        version: 2,
        views: [{}, {}, { id: 'v', name: 'V' }],
      },
    );
    expect(migratedItems({ channels: [null, 7], groups: [null, 'x', { name: 'No id' }] })).toEqual([
      { type: 'channel' },
      { type: 'channel' },
    ]);
  });
});
