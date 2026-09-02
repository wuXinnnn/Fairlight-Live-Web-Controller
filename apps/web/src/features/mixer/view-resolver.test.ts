import type { ChannelState } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import {
  channelNameKey,
  duplicateChannelNames,
  referenceForChannel,
  resolveViewChannels,
  segmentViewChannels,
} from './view-resolver.js';

function channel(id: string, name: string, kind: ChannelState['kind'] = 'channel'): ChannelState {
  return { id, kind, name, levelDb: 0, muted: false, meterDb: -60 };
}

describe('resolveViewChannels', () => {
  it('matches references by kind and trimmed name regardless of channel ids', () => {
    const live = [channel('channel/2', 'BASS'), channel('aux/1', 'FX', 'aux')];
    const resolved = resolveViewChannels(
      {
        channels: [
          { kind: 'aux', name: 'FX', channelId: 'aux/9' },
          { kind: 'channel', name: ' BASS ', channelId: 'channel/1' },
          { kind: 'channel', name: 'FX' },
        ],
      },
      live,
    );
    expect(resolved.map((entry) => entry.channel?.id)).toEqual(['aux/1', 'channel/2', undefined]);
    expect(resolved.map((entry) => entry.index)).toEqual([0, 1, 2]);
  });

  it('prefers the last known id among duplicate names before order', () => {
    const live = [channel('channel/1', 'MIC'), channel('channel/2', 'MIC')];
    const resolved = resolveViewChannels(
      {
        channels: [
          { kind: 'channel', name: 'MIC' },
          { kind: 'channel', name: 'MIC', channelId: 'channel/1' },
        ],
      },
      live,
    );
    expect(resolved.map((entry) => entry.channel?.id)).toEqual(['channel/2', 'channel/1']);
  });

  it('claims each live channel once and marks extra references missing', () => {
    const live = [channel('channel/1', 'MIC')];
    const resolved = resolveViewChannels(
      {
        channels: [
          { kind: 'channel', name: 'MIC', channelId: 'channel/1' },
          { kind: 'channel', name: 'MIC', channelId: 'channel/1' },
        ],
      },
      live,
    );
    expect(resolved.map((entry) => entry.channel?.id)).toEqual(['channel/1', undefined]);
  });

  it('does not fall back to the id when the name changed', () => {
    const live = [channel('channel/1', 'VOCAL')];
    const resolved = resolveViewChannels(
      { channels: [{ kind: 'channel', name: 'MIC', channelId: 'channel/1' }] },
      live,
    );
    expect(resolved[0]?.channel).toBeUndefined();
  });
});

describe('duplicateChannelNames', () => {
  it('flags kind-scoped names shared by several live channels', () => {
    const duplicates = duplicateChannelNames([
      channel('channel/1', 'MIC'),
      channel('channel/2', 'MIC'),
      channel('aux/1', 'MIC', 'aux'),
      channel('channel/3', 'BASS'),
    ]);
    expect(duplicates).toEqual(new Set([channelNameKey('channel', 'MIC')]));
  });
});

describe('referenceForChannel', () => {
  it('stores kind, name, and the current id as a tie-breaker', () => {
    expect(referenceForChannel(channel('main/1', 'Main', 'main'))).toEqual({
      kind: 'main',
      name: 'Main',
      channelId: 'main/1',
    });
  });
});

describe('segmentViewChannels', () => {
  it('splits entries into contiguous group runs and flat runs', () => {
    const groups = [
      { id: 'g1', name: 'Rhythm' },
      { id: 'g2', name: 'Vocals' },
    ];
    const entries = resolveViewChannels(
      {
        channels: [
          { kind: 'channel', name: 'A' },
          { kind: 'channel', name: 'B', groupId: 'g1' },
          { kind: 'channel', name: 'C', groupId: 'g1' },
          { kind: 'channel', name: 'D' },
          { kind: 'channel', name: 'E' },
          { kind: 'channel', name: 'F', groupId: 'g2' },
          { kind: 'channel', name: 'G', groupId: 'g1' },
        ],
      },
      [],
    );
    expect(
      segmentViewChannels({ groups }, entries).map((segment) => [
        segment.group?.name,
        segment.entries.map((entry) => entry.reference.name),
      ]),
    ).toEqual([
      [undefined, ['A']],
      ['Rhythm', ['B', 'C']],
      [undefined, ['D', 'E']],
      ['Vocals', ['F']],
      ['Rhythm', ['G']],
    ]);
  });
});
