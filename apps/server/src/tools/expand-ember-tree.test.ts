import { Model } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import {
  attachMissingMixerStrips,
  discoverMixerStripRefs,
  expandEmberTree,
  hasIncompleteMixerStrips,
  incompleteMixerStripKeys,
  listMixerStripRefs,
  STRIP_STUB_DIRECTORY_TIMEOUT_MS,
  withTimeout,
} from './expand-ember-tree.js';
import type { EmberDirectoryRequest, EmberTreeClient } from './expand-ember-tree.js';

function node(
  number: number,
  contents: Model.EmberElement,
  children?: { [index: number]: Model.NumberedTreeNode<Model.EmberElement> },
): Model.NumberedTreeNode<Model.EmberElement> {
  return new Model.NumberedTreeNodeImpl(number, contents, children);
}

describe('withTimeout', () => {
  it('rejects when the promise does not settle in time', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'hang')).rejects.toThrow(
      'Timeout after 10ms: hang',
    );
  });
});

describe('expandEmberTree', () => {
  it('records a failed node and continues expanding siblings', async () => {
    const goodChild = node(2, new Model.EmberNodeImpl('ok'));
    const badChild = node(1, new Model.EmberNodeImpl('bad'));
    const root = node(1, new Model.EmberNodeImpl('root'), { 1: badChild, 2: goodChild });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === badChild) {
          throw new Error('provider timeout');
        }
        if (target === goodChild) {
          goodChild.children = {
            1: node(
              1,
              new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false),
            ),
          };
        }
        return { response: Promise.resolve(target) };
      }),
    };

    const { errors } = await expandEmberTree(client);
    expect(errors).toEqual([{ path: 'root/bad', message: 'provider timeout' }]);
    expect(goodChild.children?.[1]?.contents).toMatchObject({ identifier: 'mute' });
    expect(client.getDirectory).toHaveBeenCalled();
  });

  it('expands an empty root collection first', async () => {
    const tree: EmberTreeClient['tree'] = {};
    const client: EmberTreeClient = {
      tree,
      getDirectory: vi.fn(async () => {
        Object.assign(tree, {
          1: node(1, new Model.EmberNodeImpl('system'), {
            1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'integrated')),
          }),
        });
        return { response: Promise.resolve(undefined) };
      }),
    };

    const { errors } = await expandEmberTree(client);
    expect(errors).toEqual([]);
    expect(Object.keys(tree)).toEqual(['1']);
  });

  it('skips identifiers such as sends without calling getDirectory', async () => {
    const sends = node(11, new Model.EmberNodeImpl('sends'));
    const root = node(1, new Model.EmberNodeImpl('ch'), { 11: sends });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client, { skipIdentifiers: ['sends'] });
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('does not call getDirectory on parameters', async () => {
    const parameter = node(
      1,
      new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -3),
    );
    const root = node(1, new Model.EmberNodeImpl('ch'), { 1: parameter });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('getDirectory on strip-like nodes that have an empty children object', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === strip) {
          strip.children = {
            1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
          };
        }
        return { response: Promise.resolve(target) };
      }),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).toHaveBeenCalledWith(strip);
    expect(strip.children?.[1]?.contents).toMatchObject({ identifier: 'level' });
  });

  it('clears an empty children object on a strip before getDirectory', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    let seenChildren: unknown;
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === strip) {
          seenChildren = strip.children;
        }
        return { response: Promise.resolve(target) };
      }),
    };

    await expandEmberTree(client);
    expect(seenChildren).toBeUndefined();
  });

  it('getDirectory an unidentified empty child under a mixer bus', async () => {
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 2: ghost });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).toHaveBeenCalledWith(ghost);
  });

  it('times out unidentified mixer-bus ghosts as stubs and restores empty children', async () => {
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 2: ghost });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(() => new Promise<EmberDirectoryRequest>(() => undefined)),
    };

    const started = Date.now();
    const { errors } = await expandEmberTree(client, { timeoutMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(errors).toEqual([
      {
        path: 'channel/2',
        message: `Timeout after ${STRIP_STUB_DIRECTORY_TIMEOUT_MS}ms: getDirectory channel/2`,
      },
    ]);
    expect(ghost.children).toEqual({});
  });

  it('does not getDirectory on an already expanded bus root', async () => {
    const strip = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
    });
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: strip });
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });

  it('does not getDirectory on a bus root with empty children', async () => {
    const root = node(1, new Model.EmberNodeImpl('channel'), {});
    const client: EmberTreeClient = {
      tree: { 1: root },
      getDirectory: vi.fn(async () => ({ response: Promise.resolve(undefined) })),
    };

    await expandEmberTree(client);
    expect(client.getDirectory).not.toHaveBeenCalled();
  });
});

describe('incomplete mixer strips', () => {
  it('reports online strips that are missing required parameters', () => {
    const complete = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
      2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
      4: node(4, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, 'BASS')),
    });
    const stub = node(2, new Model.EmberNodeImpl('channel2'), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: complete, 2: stub });
    const tree = { 1: root };
    expect(hasIncompleteMixerStrips(tree)).toBe(true);
    expect(incompleteMixerStripKeys(tree)).toEqual(['channel/channel2']);
  });

  it('ignores offline stubs and complete strips', () => {
    const complete = node(1, new Model.EmberNodeImpl('channel1'), {
      1: node(1, new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6)),
      2: node(2, new Model.ParameterImpl(Model.ParameterType.Boolean, 'mute', undefined, false)),
      4: node(4, new Model.ParameterImpl(Model.ParameterType.String, 'name', undefined, 'BASS')),
    });
    const offline = node(2, new Model.EmberNodeImpl('channel2', undefined, true, false), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: complete, 2: offline });
    expect(hasIncompleteMixerStrips({ 1: root })).toBe(false);
  });
});

describe('mixer strip discovery', () => {
  it('lists strip refs from an already expanded tree', () => {
    const root = node(1, new Model.EmberNodeImpl('channel'), {
      1: node(1, new Model.EmberNodeImpl('channel1')),
      2: node(2, new Model.EmberNodeImpl('channel2')),
    });
    expect(listMixerStripRefs({ 1: root })).toEqual([
      { bus: 'channel', number: 1, identifier: 'channel1' },
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
  });

  it('getDirectory mixer bus roots on a fresh tree and lists the strips', async () => {
    const strip = node(2, new Model.EmberNodeImpl('channel2'));
    const root = node(1, new Model.EmberNodeImpl('channel'));
    const tree: EmberTreeClient['tree'] = {};
    const client: EmberTreeClient = {
      tree,
      getDirectory: vi.fn(async (target): Promise<EmberDirectoryRequest> => {
        if (target === tree) {
          Object.assign(tree, { 1: root });
        }
        if (target === root) {
          root.children = { 2: strip };
        }
        return { response: Promise.resolve(target) };
      }),
    };
    const { refs, errors } = await discoverMixerStripRefs(client);
    expect(errors).toEqual([]);
    expect(refs).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(client.getDirectory).toHaveBeenCalledTimes(2);
  });

  it('attaches missing strip stubs without replacing existing children', () => {
    const existing = node(1, new Model.EmberNodeImpl('channel1'));
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: existing });
    const tree = { 1: root };
    const added = attachMissingMixerStrips(tree, [
      { bus: 'channel', number: 1, identifier: 'channel1' },
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
    expect(added).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(root.children?.[1]).toBe(existing);
    expect(root.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
  });

  it('replaces an unidentified ghost occupant at the new strip number', () => {
    const existing = node(1, new Model.EmberNodeImpl('channel1'));
    const ghost = node(2, new Model.EmberNodeImpl(), {});
    const root = node(1, new Model.EmberNodeImpl('channel'), { 1: existing, 2: ghost });
    const tree = { 1: root };
    const added = attachMissingMixerStrips(tree, [
      { bus: 'channel', number: 2, identifier: 'channel2' },
    ]);
    expect(added).toEqual([{ bus: 'channel', number: 2, identifier: 'channel2' }]);
    expect(root.children?.[2]).not.toBe(ghost);
    expect(root.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
    expect(root.children?.[2]?.children).toBeUndefined();
  });
});
