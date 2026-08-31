import { Model } from 'emberplus-connection';
import { describe, expect, it, vi } from 'vitest';
import { expandEmberTree, withTimeout } from './expand-ember-tree.js';
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
});
