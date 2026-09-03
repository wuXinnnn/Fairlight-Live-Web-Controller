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
  /** Overrides the short stub timeout when the strip is known to exist on the provider. */
  stripDirectoryTimeoutMs?: number;
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
  const stripDirectoryTimeoutMs = options.stripDirectoryTimeoutMs;
  const errors: DumpError[] = [];
  const roots = Object.values(client.tree);

  if (roots.length === 0) {
    await getDirectorySafe(client, client.tree, '<root>', errors, timeoutMs);
  }

  for (const root of Object.values(client.tree)) {
    await expandNode(
      client,
      root,
      '',
      '',
      undefined,
      errors,
      timeoutMs,
      skipIdentifiers,
      stripDirectoryTimeoutMs,
    );
  }
  return { errors };
}

async function expandNode(
  client: EmberTreeClient,
  node: EmberTreeNode,
  parentNumberPath: string,
  parentIdentifierPath: string,
  parentIdentifier: string | undefined,
  errors: DumpError[],
  timeoutMs: number,
  skipIdentifiers: ReadonlySet<string>,
  stripDirectoryTimeoutMs?: number,
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

  if (shouldGetDirectory(node, identifier, parentIdentifier)) {
    const stubDirectory = isMixerBusStub(identifier, parentIdentifier);
    const directoryTimeoutMs = stubDirectory
      ? Math.min(timeoutMs, stripDirectoryTimeoutMs ?? STRIP_STUB_DIRECTORY_TIMEOUT_MS)
      : timeoutMs;
    const ok = await getDirectorySafe(client, node, identifierPath, errors, directoryTimeoutMs);
    if (!ok) {
      if (stubDirectory && node.children === undefined) {
        node.children = {};
      }
      return;
    }
  }

  if (node.children === undefined) {
    return;
  }
  for (const child of Object.values(node.children)) {
    await expandNode(
      client,
      child,
      numberPath,
      identifierPath,
      identifier,
      errors,
      timeoutMs,
      skipIdentifiers,
      stripDirectoryTimeoutMs,
    );
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

function isMixerBus(identifier: string | undefined): identifier is (typeof CHANNEL_KINDS)[number] {
  return identifier !== undefined && CHANNEL_KINDS.some((kind) => kind === identifier);
}

/** Strip stubs and identifier-less ghosts under a mixer bus hang if given the full timeout. */
function isMixerBusStub(
  identifier: string | undefined,
  parentIdentifier: string | undefined,
): boolean {
  return (
    isStripIdentifier(identifier) || (identifier === undefined && isMixerBus(parentIdentifier))
  );
}

function hasEmptyChildren(node: EmberTreeNode): boolean {
  return node.children !== undefined && Object.keys(node.children).length === 0;
}

/**
 * GetDirectory empty strip stubs; never re-fetch an already-expanded bus/system root.
 * emberplus-connection only attaches GetDirectory children when `node.children` is undefined,
 * so an empty `{}` stub must be cleared first. Re-GetDirectory on a Fairlight bus root hangs
 * until timeout because the provider answers with contents only.
 */
function shouldGetDirectory(
  node: EmberTreeNode,
  identifier: string | undefined,
  parentIdentifier?: string | undefined,
): boolean {
  if (!canBeExpanded(node)) {
    return false;
  }
  if (node.children === undefined) {
    return true;
  }
  if (identifier !== undefined && BUS_ROOT_IDENTIFIERS.has(identifier)) {
    return false;
  }
  if (isMixerBusStub(identifier, parentIdentifier) && hasEmptyChildren(node)) {
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

export interface MixerStripRef {
  bus: string;
  number: number;
  identifier: string;
}

export function mixerStripKey(ref: MixerStripRef): string {
  return `${ref.bus}/${ref.identifier}`;
}

export function listMixerStripRefs(tree: EmberCollection): MixerStripRef[] {
  const refs: MixerStripRef[] = [];
  for (const root of Object.values(tree)) {
    const bus = readIdentifier(root);
    if (bus === undefined || !CHANNEL_KINDS.some((kind) => kind === bus)) {
      continue;
    }
    const pattern = new RegExp(`^${bus}\\d+$`);
    for (const child of Object.values(root.children ?? {})) {
      const identifier = readIdentifier(child);
      if (identifier === undefined || !pattern.test(identifier)) {
        continue;
      }
      refs.push({ bus, number: child.number, identifier });
    }
  }
  return refs;
}

/** Fresh-client GetDirectory of mixer bus roots only; does not walk strip parameters. */
export async function discoverMixerStripRefs(
  client: EmberTreeClient,
  options: ExpandOptions = {},
): Promise<{ refs: MixerStripRef[]; errors: DumpError[] }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const errors: DumpError[] = [];
  if (Object.values(client.tree).length === 0) {
    await getDirectorySafe(client, client.tree, '<root>', errors, timeoutMs);
  }
  for (const root of Object.values(client.tree)) {
    const bus = readIdentifier(root);
    if (bus === undefined || !CHANNEL_KINDS.some((kind) => kind === bus)) {
      continue;
    }
    if (!canBeExpanded(root)) {
      continue;
    }
    if (root.children === undefined || hasEmptyChildren(root)) {
      if (hasEmptyChildren(root)) {
        root.children = undefined;
      }
      await getDirectorySafe(client, root, bus, errors, timeoutMs);
    }
  }
  return { refs: listMixerStripRefs(client.tree), errors };
}

export function attachMissingMixerStrips(
  tree: EmberCollection,
  refs: readonly MixerStripRef[],
): MixerStripRef[] {
  const known = new Set(listMixerStripRefs(tree).map(mixerStripKey));
  const added: MixerStripRef[] = [];
  for (const ref of refs) {
    if (known.has(mixerStripKey(ref))) {
      continue;
    }
    const root = Object.values(tree).find((node) => readIdentifier(node) === ref.bus);
    if (root === undefined) {
      continue;
    }
    if (root.children === undefined) {
      root.children = {};
    }
    const occupant = root.children[ref.number];
    if (occupant !== undefined) {
      const occupantId = readIdentifier(occupant);
      if (occupantId === ref.identifier) {
        if (hasEmptyChildren(occupant)) {
          occupant.children = undefined;
        }
        added.push(ref);
        continue;
      }
      if (occupantId !== undefined && stripHasRequiredParams(occupant)) {
        continue;
      }
    }
    const stub = new Model.NumberedTreeNodeImpl(
      ref.number,
      new Model.EmberNodeImpl(ref.identifier),
    );
    stub.parent = root;
    root.children[ref.number] = stub;
    added.push(ref);
  }
  return added;
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
