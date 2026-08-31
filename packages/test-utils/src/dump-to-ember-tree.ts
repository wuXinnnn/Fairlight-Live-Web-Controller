import { Model } from 'emberplus-connection';
import type { DumpJsonValue, DumpNode, DumpTree } from './dump-types.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { [index: number]: EmberTreeNode };

export function dumpToEmberTree(dump: DumpTree): EmberCollection {
  const tree: EmberCollection = {};
  for (const node of dump.nodes) {
    tree[node.number] = dumpNodeToEmber(node);
  }
  return tree;
}

export function dumpNodeToEmber(node: DumpNode): EmberTreeNode {
  const contents = toContents(node);
  const children = toChildren(node.children);
  return new Model.NumberedTreeNodeImpl(node.number, contents, children);
}

function toChildren(nodes: DumpNode[] | undefined): EmberCollection | undefined {
  if (nodes === undefined || nodes.length === 0) {
    return undefined;
  }
  const children: EmberCollection = {};
  for (const child of nodes) {
    children[child.number] = dumpNodeToEmber(child);
  }
  return children;
}

function toContents(node: DumpNode): Model.EmberElement {
  switch (node.elementType) {
    case 'PARAMETER':
      return new Model.ParameterImpl(
        toParameterType(node.parameterType),
        node.identifier,
        node.description,
        fromDumpValue(node.value),
        node.maximum ?? undefined,
        node.minimum ?? undefined,
        toAccess(node.access),
        node.format,
        node.enumeration,
        node.factor,
        undefined,
        undefined,
        undefined,
        undefined,
        node.streamIdentifier,
      );
    case 'FUNCTION':
      return new Model.EmberFunctionImpl(node.identifier, node.description);
    case 'MATRIX':
      return new Model.MatrixImpl(
        node.identifier ?? `matrix-${node.number}`,
        undefined,
        undefined,
        undefined,
        node.description,
      );
    case 'NODE':
    case 'TEMPLATE':
    case 'COMMAND':
      return new Model.EmberNodeImpl(node.identifier, node.description, node.isRoot, node.isOnline);
  }
}

export function fromDumpValue(value: DumpJsonValue | undefined): Model.Parameter['value'] {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'object' && value !== null && '$buffer' in value) {
    return Buffer.from(value.$buffer, 'hex');
  }
  return value;
}

function toParameterType(value: string | undefined): Model.ParameterType {
  switch (value) {
    case Model.ParameterType.Integer:
      return Model.ParameterType.Integer;
    case Model.ParameterType.Real:
      return Model.ParameterType.Real;
    case Model.ParameterType.String:
      return Model.ParameterType.String;
    case Model.ParameterType.Boolean:
      return Model.ParameterType.Boolean;
    case Model.ParameterType.Trigger:
      return Model.ParameterType.Trigger;
    case Model.ParameterType.Enum:
      return Model.ParameterType.Enum;
    case Model.ParameterType.Octets:
      return Model.ParameterType.Octets;
    default:
      return Model.ParameterType.Null;
  }
}

function toAccess(value: string | undefined): Model.ParameterAccess | undefined {
  switch (value) {
    case Model.ParameterAccess.None:
      return Model.ParameterAccess.None;
    case Model.ParameterAccess.Read:
      return Model.ParameterAccess.Read;
    case Model.ParameterAccess.Write:
      return Model.ParameterAccess.Write;
    case Model.ParameterAccess.ReadWrite:
      return Model.ParameterAccess.ReadWrite;
    default:
      return undefined;
  }
}
