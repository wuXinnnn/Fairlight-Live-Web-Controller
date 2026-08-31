import { Model } from 'emberplus-connection';
import type { DumpError } from './dump-types.js';
import { joinIdentifierPath, joinNumberPath } from './serialize-ember-tree.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { readonly [index: number]: EmberTreeNode };

export interface EmberDirectoryRequest {
  response?: Promise<unknown>;
}

export interface EmberTreeClient {
  tree: EmberCollection;
  getDirectory(node: EmberTreeNode | EmberCollection): Promise<EmberDirectoryRequest>;
}

export interface ExpandOptions {
  timeoutMs?: number;
  skipIdentifiers?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function expandEmberTree(
  client: EmberTreeClient,
  options: ExpandOptions = {},
): Promise<{ errors: DumpError[] }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipIdentifiers = new Set(options.skipIdentifiers ?? []);
  const errors: DumpError[] = [];
  const roots = Object.values(client.tree);

  if (roots.length === 0) {
    await getDirectorySafe(client, client.tree, '<root>', errors, timeoutMs);
  }

  for (const root of Object.values(client.tree)) {
    await expandNode(client, root, '', '', errors, timeoutMs, skipIdentifiers);
  }
  return { errors };
}

async function expandNode(
  client: EmberTreeClient,
  node: EmberTreeNode,
  parentNumberPath: string,
  parentIdentifierPath: string,
  errors: DumpError[],
  timeoutMs: number,
  skipIdentifiers: ReadonlySet<string>,
): Promise<void> {
  const numberPath = joinNumberPath(parentNumberPath, node.number);
  const identifier =
    'identifier' in node.contents && typeof node.contents.identifier === 'string'
      ? node.contents.identifier
      : undefined;
  const identifierPath = joinIdentifierPath(parentIdentifierPath, identifier, node.number);

  if (identifier !== undefined && skipIdentifiers.has(identifier)) {
    return;
  }

  if (canBeExpanded(node) && node.children === undefined) {
    const ok = await getDirectorySafe(client, node, identifierPath, errors, timeoutMs);
    if (!ok) {
      return;
    }
  }

  if (node.children === undefined) {
    return;
  }
  for (const child of Object.values(node.children)) {
    await expandNode(client, child, numberPath, identifierPath, errors, timeoutMs, skipIdentifiers);
  }
}

function canBeExpanded(node: EmberTreeNode): boolean {
  if (node.contents.type === Model.ElementType.Node) {
    return node.contents.isOnline !== false;
  }
  return (
    node.contents.type !== Model.ElementType.Parameter &&
    node.contents.type !== Model.ElementType.Function
  );
}

async function getDirectorySafe(
  client: EmberTreeClient,
  node: EmberTreeNode | EmberCollection,
  path: string,
  errors: DumpError[],
  timeoutMs: number,
): Promise<boolean> {
  try {
    const request = await withTimeout(client.getDirectory(node), timeoutMs, `getDirectory ${path}`);
    if (request.response !== undefined) {
      await withTimeout(request.response, timeoutMs, `getDirectory response ${path}`);
    }
    return true;
  } catch (error) {
    errors.push({ path, message: errorMessage(error) });
    return false;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
