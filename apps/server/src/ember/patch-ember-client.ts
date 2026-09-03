import type { EmberTreeNode } from './types.js';

type TreeUpdateFn = (update: EmberTreeNode, tree: EmberTreeNode | undefined) => unknown[];
type IncomingFn = (incoming: unknown) => void;

interface EmberClientWithTreeMerge {
  _updateTree?: TreeUpdateFn;
  _handleIncoming?: IncomingFn;
}

export interface EmberTreeMergeOptions {
  onChildrenAdded?: () => void;
  onIncomingError?: (error: unknown) => void;
}

/**
 * emberplus-connection only attaches a new child when the parent has no children yet, or when
 * the update is a Qualified path insert. A numbered directory update that includes a new strip
 * calls `_updateTree(child, undefined)` and throws, so the node never lands in the local tree.
 */
export function patchEmberClientTreeMerge(
  client: object,
  options: EmberTreeMergeOptions = {},
): void {
  const target = client as EmberClientWithTreeMerge;
  const original = target._updateTree;
  if (original === undefined) {
    return;
  }

  target._updateTree = function updateTree(
    this: EmberClientWithTreeMerge,
    update: EmberTreeNode,
    tree: EmberTreeNode | undefined,
  ): unknown[] {
    if (tree === undefined) {
      return [];
    }
    const hadChildren = tree.children !== undefined && Object.keys(tree.children).length > 0;
    let added = false;
    if (update.children !== undefined) {
      if (tree.children === undefined) {
        tree.children = {};
      }
      for (const child of Object.values(update.children)) {
        if (tree.children[child.number] === undefined) {
          tree.children[child.number] = child;
          child.parent = tree;
          added = true;
        }
      }
    }
    if (added && hadChildren) {
      options.onChildrenAdded?.();
    }
    return original.call(this, update, tree);
  };

  const incoming = target._handleIncoming;
  if (incoming === undefined) {
    return;
  }
  target._handleIncoming = function handleIncoming(
    this: EmberClientWithTreeMerge,
    payload: unknown,
  ): void {
    try {
      incoming.call(this, payload);
    } catch (error) {
      options.onIncomingError?.(error);
    }
  };
}
