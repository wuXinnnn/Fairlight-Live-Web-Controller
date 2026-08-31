import { Model } from 'emberplus-connection';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { readonly [index: number]: EmberTreeNode };

export function getNodeByNumberPath(
  tree: EmberCollection,
  numberPath: string,
): EmberTreeNode | undefined {
  const segments = numberPath.split('.').filter((segment) => segment !== '');
  if (segments.length === 0) {
    return undefined;
  }
  let current: EmberTreeNode | undefined;
  let collection: EmberCollection | undefined = tree;
  for (const segment of segments) {
    if (collection === undefined) {
      return undefined;
    }
    const number = Number(segment);
    current =
      collection[number] ?? Object.values(collection).find((node) => node.number === number);
    if (current === undefined) {
      return undefined;
    }
    collection = current.children;
  }
  return current;
}

export function asParameterNode(
  node: EmberTreeNode | undefined,
  label: string,
): Model.NumberedTreeNode<Model.Parameter> {
  if (node === undefined || node.contents.type !== Model.ElementType.Parameter) {
    throw new Error(`Expected a parameter at ${label}`);
  }
  return node as Model.NumberedTreeNode<Model.Parameter>;
}
