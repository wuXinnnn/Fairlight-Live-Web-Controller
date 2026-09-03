import { Model } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import {
  expandEmberTree,
  hasIncompleteMixerStrips,
  incompleteMixerStripKeys,
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
