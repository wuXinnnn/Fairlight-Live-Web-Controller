import { EmberClient, Model } from 'emberplus-connection';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchEmberClientTreeMerge } from './patch-ember-client.js';
import { emberNode } from './tree-helpers.js';
import type { EmberTreeNode } from './types.js';

interface EmberClientHarness {
  tree: { [index: number]: EmberTreeNode };
  _handleIncoming(incoming: { value: { [index: number]: EmberTreeNode } }): void;
}

interface MergeClient {
  _updateTree(update: EmberTreeNode, tree?: EmberTreeNode): unknown[];
  _handleIncoming?(payload: unknown): void;
}

function stripStub(number: number, identifier: string): EmberTreeNode {
  return emberNode(number, new Model.EmberNodeImpl(identifier));
}

describe('patchEmberClientTreeMerge', () => {
  const clients: EmberClient[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.discard();
    }
  });

  it('inserts missing numbered children before the library recurses', () => {
    const existing = stripStub(1, 'channel1');
    const added = stripStub(2, 'channel2');
    const tree = emberNode(1, new Model.EmberNodeImpl('channel'), { 1: existing });
    existing.parent = tree;
    const update = emberNode(1, new Model.EmberNodeImpl('channel'), {
      1: stripStub(1, 'channel1'),
      2: added,
    });
    const seen: Array<EmberTreeNode | undefined> = [];
    const client: MergeClient = {
      _updateTree(updateNode: EmberTreeNode, current?: EmberTreeNode) {
        seen.push(current);
        if (updateNode.children !== undefined && current?.children !== undefined) {
          for (const child of Object.values(updateNode.children)) {
            this._updateTree(child, current.children[child.number]);
          }
        }
        return [];
      },
    };
    const onChildrenAdded = vi.fn();
    patchEmberClientTreeMerge(client, { onChildrenAdded });
    client._updateTree(update, tree);
    expect(tree.children?.[2]).toBe(added);
    expect(added.parent).toBe(tree);
    expect(seen).toContain(tree);
    expect(seen).toContain(added);
    expect(onChildrenAdded).toHaveBeenCalledTimes(1);
  });

  it('does not notify when GetDirectory first attaches children', () => {
    const added = stripStub(1, 'channel1');
    const tree = emberNode(1, new Model.EmberNodeImpl('channel'));
    const update = emberNode(1, new Model.EmberNodeImpl('channel'), { 1: added });
    const client: MergeClient = {
      _updateTree() {
        return [];
      },
    };
    const onChildrenAdded = vi.fn();
    patchEmberClientTreeMerge(client, { onChildrenAdded });
    client._updateTree(update, tree);
    expect(tree.children?.[1]).toBe(added);
    expect(onChildrenAdded).not.toHaveBeenCalled();
  });

  it('does nothing when the client has no _updateTree', () => {
    expect(() => patchEmberClientTreeMerge({})).not.toThrow();
  });

  it('reports _handleIncoming failures instead of throwing', () => {
    const onIncomingError = vi.fn();
    const client: MergeClient = {
      _updateTree() {
        return [];
      },
      _handleIncoming() {
        throw new Error('merge failed');
      },
    };
    patchEmberClientTreeMerge(client, { onIncomingError });
    expect(() => client._handleIncoming?.({})).not.toThrow();
    expect(onIncomingError).toHaveBeenCalledWith(expect.objectContaining({ message: 'merge failed' }));
  });

  it('lets emberplus-connection merge a numbered directory update with a new strip', () => {
    const client = new EmberClient('127.0.0.1', 1, 50);
    clients.push(client);
    const existing = stripStub(1, 'channel1');
    const root = emberNode(1, new Model.EmberNodeImpl('channel'), { 1: existing });
    existing.parent = root;
    const harness = client as unknown as EmberClientHarness;
    harness.tree[1] = root;

    const added = stripStub(2, 'channel2');
    const update = emberNode(1, new Model.EmberNodeImpl('channel'), {
      1: stripStub(1, 'channel1'),
      2: added,
    });

    expect(() => {
      harness._handleIncoming({ value: { 1: update } });
    }).toThrow();
    expect(root.children?.[2]).toBeUndefined();

    patchEmberClientTreeMerge(client);
    expect(() => {
      harness._handleIncoming({ value: { 1: update } });
    }).not.toThrow();
    expect(root.children?.[2]?.contents).toMatchObject({ identifier: 'channel2' });
  });
});
