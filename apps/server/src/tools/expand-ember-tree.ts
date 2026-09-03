import { CHANNEL_KINDS } from '@flwc/shared';
import { Model } from 'emberplus-connection';
import type { DumpError } from './dump-types.js';
import { joinIdentifierPath, joinNumberPath } from './serialize-ember-tree.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { readonly [index: number]: EmberTreeNode };

const BUS_ROOT_IDENTIFIERS = new Set<string>(['system', ...CHANNEL_KINDS]);
const STRIP_IDENTIFIER = new RegExp(`^(${CHANNEL_KINDS.join('|')})\\d+$`);
const REQUIRED_STRIP_PARAMS = ['level', 'mute', 'name'] as const;

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
/** Empty strip stubs must not use the full protocol timeout; GetDirectory hangs until children exist. */
export const STRIP_STUB_DIRECTORY_TIMEOUT_MS = 400;

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

  if (shouldGetDirectory(node, identifier)) {
    const directoryTimeoutMs = isStripIdentifier(identifier)
      ? Math.min(timeoutMs, STRIP_STUB_DIRECTORY_TIMEOUT_MS)
      : timeoutMs;
    const ok = await getDirectorySafe(client, node, identifierPath, errors, directoryTimeoutMs);
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

function isStripIdentifier(identifier: string | undefined): boolean {
  return identifier !== undefined && STRIP_IDENTIFIER.test(identifier);
}

function hasEmptyChildren(node: EmberTreeNode): boolean {
  return node.children !== undefined && Object.keys(node.children).length === 0;
}

/**
 * GetDirectory empty strip stubs; never re-fetch an already-expanded bus/system root.
 * emberplus-connection only attaches GetDirectory children when `node.children` is undefined,
 * so an empty `{}` stub must be cleared first.
 */
function shouldGetDirectory(node: EmberTreeNode, identifier: string | undefined): boolean {
  if (!canBeExpanded(node)) {
    return false;
  }
  if (node.children === undefined) {
    return true;
  }
  if (identifier !== undefined && BUS_ROOT_IDENTIFIERS.has(identifier)) {
    return false;
  }
  if (isStripIdentifier(identifier) && hasEmptyChildren(node)) {
    node.children = undefined;
    return true;
  }
  return false;
}

function readIdentifier(node: EmberTreeNode): string | undefined {
  return 'identifier' in node.contents && typeof node.contents.identifier === 'string'
    ? node.contents.identifier
    : undefined;
}

function isNodeOnline(node: EmberTreeNode): boolean {
  return !('isOnline' in node.contents) || node.contents.isOnline !== false;
}

function stripHasRequiredParams(node: EmberTreeNode): boolean {
  const identifiers = new Set(
    Object.values(node.children ?? {})
      .map((child) => readIdentifier(child))
      .filter((identifier): identifier is string => identifier !== undefined),
  );
  return REQUIRED_STRIP_PARAMS.every((identifier) => identifiers.has(identifier));
}

/** True when an online `channelN`-style strip is present but still missing level/mute/name. */
export function hasIncompleteMixerStrips(tree: EmberCollection): boolean {
  return incompleteMixerStripKeys(tree).length > 0;
}

export function incompleteMixerStripKeys(tree: EmberCollection): string[] {
  const keys: string[] = [];
  for (const root of Object.values(tree)) {
    const rootId = readIdentifier(root);
    if (rootId === undefined || !CHANNEL_KINDS.some((kind) => kind === rootId)) {
      continue;
    }
    if (!isNodeOnline(root)) {
      continue;
    }
    const pattern = new RegExp(`^${rootId}\\d+$`);
    for (const child of Object.values(root.children ?? {})) {
      const identifier = readIdentifier(child);
      if (identifier === undefined || !pattern.test(identifier)) {
        continue;
      }
      if (!isNodeOnline(child) || stripHasRequiredParams(child)) {
        continue;
      }
      keys.push(`${rootId}/${identifier}`);
    }
  }
  return keys;
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
