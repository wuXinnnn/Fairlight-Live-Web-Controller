import { describe, expect, it } from 'vitest';
import { channelRowKeys, groupRowKey } from './row-keys.js';

describe('row keys', () => {
  it('builds stable keys from kind, name, channel id and occurrence ordinal', () => {
    expect(
      channelRowKeys({
        items: [
          { type: 'channel', kind: 'channel', name: 'MIC', channelId: 'channel/1' },
          {
            type: 'group',
            id: 'g1',
            name: 'Rhythm',
            channels: [
              { kind: 'channel', name: 'MIC', channelId: 'channel/1' },
              { kind: 'channel', name: 'MIC' },
            ],
          },
          { type: 'channel', kind: 'aux', name: 'MIC', channelId: 'aux/1' },
        ],
      }),
    ).toEqual([
      'channel:MIC:channel/1#0',
      'channel:MIC:channel/1#1',
      'channel:MIC:#0',
      'aux:MIC:aux/1#0',
    ]);
    expect(groupRowKey('g1')).toBe('group:g1');
  });

  it('counts occurrences across the whole list, members included', () => {
    // Keys are handed out in display order, so a member and a root row of the same reference
    // are told apart by where they sit rather than by which list they are in.
    expect(
      channelRowKeys({
        items: [
          { type: 'group', id: 'g1', name: 'One', channels: [{ kind: 'main', name: 'M' }] },
          { type: 'channel', kind: 'main', name: 'M' },
        ],
      }),
    ).toEqual(['main:M:#0', 'main:M:#1']);
    expect(channelRowKeys({ items: [] })).toEqual([]);
  });
});
