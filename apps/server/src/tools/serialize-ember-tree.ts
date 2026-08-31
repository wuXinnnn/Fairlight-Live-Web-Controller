import { Model } from 'emberplus-connection';
import type { DumpElementType, DumpJsonValue, DumpNode } from './dump-types.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;

const ELEMENT_TYPE_MAP: Record<Model.ElementType, DumpElementType> = {
  [Model.ElementType.Node]: 'NODE',
  [Model.ElementType.Parameter]: 'PARAMETER',
  [Model.ElementType.Function]: 'FUNCTION',
  [Model.ElementType.Matrix]: 'MATRIX',
  [Model.ElementType.Template]: 'TEMPLATE',
  [Model.ElementType.Command]: 'COMMAND',
};

export function serializeEmberTree(
  roots: Iterable<EmberTreeNode>,
  expandErrors: ReadonlyMap<string, string> = new Map(),
): DumpNode[] {
  return [...roots]
    .sort((left, right) => left.number - right.number)
    .map((node) => serializeNode(node, '', '', expandErrors));
}

function serializeNode(
  node: EmberTreeNode,
  parentNumberPath: string,
  parentIdentifierPath: string,
  expandErrors: ReadonlyMap<string, string>,
): DumpNode {
  const numberPath = joinNumberPath(parentNumberPath, node.number);
  const identifier = readIdentifier(node);
  const identifierPath = joinIdentifierPath(parentIdentifierPath, identifier, node.number);
  const contents = node.contents;
  const dump: DumpNode = {
    number: node.number,
    numberPath,
    identifierPath,
    elementType: ELEMENT_TYPE_MAP[contents.type],
  };

  if (identifier !== undefined) {
    dump.identifier = identifier;
  }
  if ('description' in contents && contents.description !== undefined) {
    dump.description = contents.description;
  }
  if (contents.type === Model.ElementType.Node) {
    if (contents.isOnline !== undefined) {
      dump.isOnline = contents.isOnline;
    }
    if (contents.isRoot !== undefined) {
      dump.isRoot = contents.isRoot;
    }
  }
  if (contents.type === Model.ElementType.Parameter) {
    dump.parameterType = contents.parameterType;
    const value = toDumpValue(contents.value);
    if (value !== undefined) {
      dump.value = value;
    }
    if (contents.minimum !== undefined) {
      dump.minimum = contents.minimum;
    }
    if (contents.maximum !== undefined) {
      dump.maximum = contents.maximum;
    }
    if (contents.format !== undefined) {
      dump.format = contents.format;
    }
    if (contents.access !== undefined) {
      dump.access = contents.access;
    }
    if (contents.streamIdentifier !== undefined) {
      dump.streamIdentifier = contents.streamIdentifier;
    }
    if (contents.factor !== undefined) {
      dump.factor = contents.factor;
    }
    if (contents.enumeration !== undefined) {
      dump.enumeration = contents.enumeration;
    }
  }

  const error = expandErrors.get(numberPath) ?? expandErrors.get(identifierPath);
  if (error !== undefined) {
    dump.error = error;
  }

  const children = node.children ? Object.values(node.children) : [];
  if (children.length > 0) {
    dump.children = children
      .sort((left, right) => left.number - right.number)
      .map((child) => serializeNode(child, numberPath, identifierPath, expandErrors));
  }
  return dump;
}

function readIdentifier(node: EmberTreeNode): string | undefined {
  if ('identifier' in node.contents && typeof node.contents.identifier === 'string') {
    return node.contents.identifier;
  }
  return undefined;
}

export function joinNumberPath(parent: string, number: number): string {
  return parent === '' ? String(number) : `${parent}.${number}`;
}

export function joinIdentifierPath(
  parent: string,
  identifier: string | undefined,
  number: number,
): string {
  const segment = identifier !== undefined && identifier !== '' ? identifier : String(number);
  return parent === '' ? segment : `${parent}/${segment}`;
}

export function toDumpValue(value: unknown): DumpJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { $buffer: value.toString('hex') };
  }
  return String(value);
}
