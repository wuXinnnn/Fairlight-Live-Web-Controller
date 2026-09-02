import { Model } from 'emberplus-connection';
import type { EmberFunctionNode, EmberParameterNode, EmberTreeNode } from './types.js';

export function readIdentifier(node: EmberTreeNode): string | undefined {
  return 'identifier' in node.contents && typeof node.contents.identifier === 'string'
    ? node.contents.identifier
    : undefined;
}

export function isParameterNode(node: EmberTreeNode): node is EmberParameterNode {
  return node.contents.type === Model.ElementType.Parameter;
}

export function isFunctionNode(node: EmberTreeNode): node is EmberFunctionNode {
  return node.contents.type === Model.ElementType.Function;
}

export function readNumericValue(node: EmberParameterNode): number | undefined {
  return typeof node.contents.value === 'number' ? node.contents.value : undefined;
}

export function readBooleanValue(node: EmberParameterNode): boolean | undefined {
  return typeof node.contents.value === 'boolean' ? node.contents.value : undefined;
}

export function readStringValue(node: EmberParameterNode): string | undefined {
  return typeof node.contents.value === 'string' ? node.contents.value : undefined;
}

export function isNodeOnline(node: EmberTreeNode): boolean {
  return !('isOnline' in node.contents) || node.contents.isOnline !== false;
}

export function childNodes(node: EmberTreeNode): EmberTreeNode[] {
  return node.children === undefined ? [] : Object.values(node.children);
}

export function findChildByIdentifier(
  node: EmberTreeNode,
  identifier: string,
): EmberTreeNode | undefined {
  return childNodes(node).find((child) => readIdentifier(child) === identifier);
}
