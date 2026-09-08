import { describe, expect, it } from 'vitest';
import { channelRowKeys, groupRowKey } from './row-keys.js';

describe('row keys', () => {
  it('builds stable keys from kind, name, channel id and occurrence ordinal', () => {
    expect(
      channelRowKeys({
        channels: [
          { kind: 'channel', name: 'MIC', channelId: 'channel/1' },
          { kind: 'channel', name: 'MIC', channelId: 'channel/1', groupId: 'g1' },
          { kind: 'channel', name: 'MIC' },
          { kind: 'aux', name: 'MIC', channelId: 'aux/1' },
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
});
