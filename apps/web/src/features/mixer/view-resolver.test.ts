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
        items: [
          { type: 'channel', kind: 'aux', name: 'FX', channelId: 'aux/9' },
          { type: 'channel', kind: 'channel', name: ' BASS ', channelId: 'channel/1' },
          { type: 'channel', kind: 'channel', name: 'FX' },
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
        items: [
          { type: 'channel', kind: 'channel', name: 'MIC' },
          { type: 'channel', kind: 'channel', name: 'MIC', channelId: 'channel/1' },
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
        items: [
          { type: 'channel', kind: 'channel', name: 'MIC', channelId: 'channel/1' },
          { type: 'channel', kind: 'channel', name: 'MIC', channelId: 'channel/1' },
        ],
      },
      live,
    );
    expect(resolved.map((entry) => entry.channel?.id)).toEqual(['channel/1', undefined]);
  });

  it('does not fall back to the id when the name changed', () => {
    const live = [channel('channel/1', 'VOCAL')];
    const resolved = resolveViewChannels(
      { items: [{ type: 'channel', kind: 'channel', name: 'MIC', channelId: 'channel/1' }] },
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
  const row = (name: string) => ({ type: 'channel' as const, kind: 'channel' as const, name });
  const members = (...names: string[]) => names.map((name) => ({ kind: 'channel' as const, name }));

  it('makes one segment per group block and runs the loose rows together', () => {
    // A group owns its members now, so it is always exactly one segment. Version 1 let the same
    // group appear twice when its members were not next to each other; that cannot happen here.
    const view = {
      items: [
        row('A'),
        { type: 'group' as const, id: 'g1', name: 'Rhythm', channels: members('B', 'C') },
        row('D'),
        row('E'),
        { type: 'group' as const, id: 'g2', name: 'Vocals', channels: members('F') },
        row('G'),
      ],
    };
    expect(
      segmentViewChannels(view, resolveViewChannels(view, [])).map((segment) => [
        segment.group?.name,
        segment.entries.map((entry) => entry.reference.name),
      ]),
    ).toEqual([
      [undefined, ['A']],
      ['Rhythm', ['B', 'C']],
      [undefined, ['D', 'E']],
      ['Vocals', ['F']],
      [undefined, ['G']],
    ]);
  });

  it('leaves an empty group out entirely, wherever it sits', () => {
    const view = {
      items: [
        { type: 'group' as const, id: 'g0', name: 'Nothing', channels: [] },
        row('A'),
        { type: 'group' as const, id: 'g1', name: 'Empty', channels: [] },
        row('B'),
      ],
    };
    expect(
      segmentViewChannels(view, resolveViewChannels(view, [])).map((segment) => [
        segment.group?.name,
        segment.entries.map((entry) => entry.reference.name),
      ]),
      // An empty group renders nothing here, so the rows on either side of it read as one run
      // rather than being split by a section the viewer cannot see.
    ).toEqual([[undefined, ['A', 'B']]]);
    expect(segmentViewChannels({ items: [] }, [])).toEqual([]);
  });
});
