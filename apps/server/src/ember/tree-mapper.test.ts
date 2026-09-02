import { Model } from 'emberplus-connection';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { ChannelNotFoundError } from './errors.js';
import { emberNode, parameterNode, requiredTree, stripNode } from './tree-helpers.js';
import { TreeMapper } from './tree-mapper.js';

describe('TreeMapper', () => {
  it('maps present bus kinds and skips missing sub/mixm/mtx roots', () => {
    const mapper = new TreeMapper(silentLogger());
    const result = mapper.sync(requiredTree());
    expect(result.added.map((channel) => channel.id).sort()).toEqual([
      'aux/1',
      'channel/1',
      'main/1',
    ]);
    expect(result.structureChanged).toBe(true);
    expect(result.loudness).toEqual({ integratedLufs: -23, truePeakDbtp: -6 });
    expect(mapper.get('sub/1')).toBeUndefined();
    expect(mapper.get('mixm/1')).toBeUndefined();
    expect(mapper.get('mtx/1')).toBeUndefined();
  });

  it('recognizes a sub root when the tree actually has one', () => {
    const mapper = new TreeMapper(silentLogger());
    const result = mapper.sync(requiredTree({ includeSub: true }));
    expect(result.added.some((channel) => channel.id === 'sub/1' && channel.name === 'Sub')).toBe(
      true,
    );
    expect(mapper.resolveParameter('sub/1', 'level').contents.identifier).toBe('level');
  });

  it('ignores an offline bus root', () => {
    const mapper = new TreeMapper(silentLogger());
    const tree = {
      ...requiredTree(),
      1: emberNode(1, new Model.EmberNodeImpl('channel', undefined, false, false), {
        1: stripNode('channel', 1, 'BASS'),
      }),
    };
    const result = mapper.sync(tree);
    expect(result.added.map((channel) => channel.id)).not.toContain('channel/1');
  });

  it('treats an offline strip as removed on the next sync', () => {
    const mapper = new TreeMapper(silentLogger());
    mapper.sync(requiredTree());
    const next = requiredTree();
    const channelRoot = next[1];
    if (channelRoot?.children !== undefined) {
      channelRoot.children[2] = stripNode('channel', 2, 'PC');
    }
    mapper.sync(next);
    const offline = requiredTree();
    const remaining = offline[1];
    if (remaining?.children !== undefined) {
      remaining.children[2] = stripNode('channel', 2, 'PC');
      remaining.children[2].contents = new Model.EmberNodeImpl('channel2', 'PC', false, false);
    }
    const result = mapper.sync(offline);
    expect(result.removedIds).toEqual(['channel/2']);
    expect(result.structureChanged).toBe(true);
    expect(mapper.get('channel/2')).toBeUndefined();
  });

  it('diffs channel add and remove on later syncs', () => {
    const mapper = new TreeMapper(silentLogger());
    mapper.sync(requiredTree());
    const grown = requiredTree();
    const channelRoot = grown[1];
    if (channelRoot?.children !== undefined) {
      channelRoot.children[2] = stripNode('channel', 2, 'PC');
    }
    const added = mapper.sync(grown);
    expect(added.added.map((channel) => channel.id)).toEqual(['channel/2']);
    expect(added.removedIds).toEqual([]);
    expect(added.structureChanged).toBe(true);

    const shrunk = requiredTree();
    const removed = mapper.sync(shrunk);
    expect(removed.removedIds).toEqual(['channel/2']);
    expect(removed.added).toEqual([]);
  });

  it('emits updated state when a mapped parameter value changes', () => {
    const mapper = new TreeMapper(silentLogger());
    mapper.sync(requiredTree());
    const next = requiredTree();
    const name = next[1]?.children?.[1]?.children?.[4];
    if (name !== undefined && name.contents.type === Model.ElementType.Parameter) {
      name.contents.value = 'BASS-2';
    }
    const result = mapper.sync(next);
    expect(result.structureChanged).toBe(false);
    expect(result.updated).toEqual([expect.objectContaining({ id: 'channel/1', name: 'BASS-2' })]);
  });

  it('skips incomplete strips and unknown nodes', () => {
    const mapper = new TreeMapper(silentLogger());
    const tree = {
      1: emberNode(1, new Model.EmberNodeImpl('channel'), {
        1: stripNode('channel', 1, 'BASS', { includeName: false }),
        2: emberNode(2, new Model.EmberNodeImpl('not-a-strip')),
      }),
      9: emberNode(9, new Model.EmberNodeImpl()),
    };
    const result = mapper.sync(tree);
    expect(result.added).toEqual([]);
    expect(mapper.list()).toEqual([]);
  });

  it('defaults meter when the strip has no meter child', () => {
    const mapper = new TreeMapper(silentLogger());
    const tree = {
      1: emberNode(1, new Model.EmberNodeImpl('channel'), {
        1: stripNode('channel', 5, 'Dry', { includeMeter: false }),
      }),
    };
    const result = mapper.sync(tree);
    expect(result.added[0]).toMatchObject({ id: 'channel/5', meterDb: -60 });
  });

  it('throws when resolving an unknown channel or missing loudness reset', () => {
    const mapper = new TreeMapper(silentLogger());
    expect(() => mapper.resolveParameter('channel/9', 'level')).toThrow(ChannelNotFoundError);
    expect(() => mapper.resolveReset()).toThrow(ChannelNotFoundError);
    mapper.sync(requiredTree());
    expect(() => mapper.resolveParameter('channel/1', 'meter')).not.toThrow();
    const noMeter = new TreeMapper(silentLogger());
    noMeter.sync({
      1: emberNode(1, new Model.EmberNodeImpl('channel'), {
        1: stripNode('channel', 1, 'BASS', { includeMeter: false }),
      }),
    });
    expect(() => noMeter.resolveParameter('channel/1', 'meter')).toThrow(ChannelNotFoundError);
  });

  it('ignores a loudness node that is missing children', () => {
    const mapper = new TreeMapper(silentLogger());
    const result = mapper.sync({
      0: emberNode(0, new Model.EmberNodeImpl('system'), {
        2: emberNode(2, new Model.EmberNodeImpl('loudness'), {
          101: parameterNode(101, 'integrated', Model.ParameterType.Real, -10),
        }),
      }),
    });
    expect(result.loudness).toBeUndefined();
    expect(mapper.getLoudness()).toBeUndefined();
  });
});
