import { EventEmitter } from 'node:events';
import { EmberClient } from 'emberplus-connection';
import type { ConnectionStatus } from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';
import {
  attachMissingMixerStrips,
  discoverMixerStripRefs,
  expandEmberTree,
  incompleteMixerStripKeys,
  listMixerStripRefs,
  mixerStripKey,
  withTimeout,
} from '../tools/expand-ember-tree.js';
import { EmberProtocolError } from './errors.js';
import { childNodes, isFunctionNode, isParameterNode } from './node-utils.js';
import { patchEmberClientTreeMerge } from './patch-ember-client.js';
import type {
  EmberClientFactory,
  EmberClientHandle,
  EmberCollection,
  EmberFunctionNode,
  EmberParameterNode,
  EmberTreeNode,
  EmberValue,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_RECONNECT_INITIAL_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_TREE_REFRESH_DEBOUNCE_MS = 100;
const DEFAULT_INCOMPLETE_STRIP_RETRY_MS = 300;
const DEFAULT_BUS_DIRECTORY_POLL_MS = 2_000;
const SKIP_IDENTIFIERS = ['sends'] as const;

export interface EmberServiceOptions {
  host: string;
  port: number;
  logger: AppLogger;
  timeoutMs?: number;
  disconnectTimeoutMs?: number;
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
  treeRefreshDebounceMs?: number;
  incompleteStripRetryMs?: number;
  busDirectoryPollMs?: number;
  createClient?: EmberClientFactory;
}

export interface EmberServiceEvents {
  status: [status: ConnectionStatus];
  tree: [tree: EmberCollection];
}

export class EmberService extends EventEmitter {
  private host: string;
  private port: number;
  private readonly logger: AppLogger;
  private readonly timeoutMs: number;
  private readonly disconnectTimeoutMs: number;
  private readonly reconnectInitialMs: number;
  private readonly reconnectMaxMs: number;
  private readonly treeRefreshDebounceMs: number;
  private readonly incompleteStripRetryMs: number;
  private readonly busDirectoryPollMs: number;
  private readonly createClient: EmberClientFactory;
  private client: EmberClientHandle | undefined;
  private started = false;
  private hasConnected = false;
  private statusValue: ConnectionStatus = 'disconnected';
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private treeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private incompleteStripRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private busDirectoryPollTimer: ReturnType<typeof setInterval> | undefined;
  private mixerProbeInFlight = false;
  private readonly retriedIncompleteStrips = new Set<string>();
  private treeRefreshTail: Promise<void> = Promise.resolve();
  private writeTail: Promise<void> = Promise.resolve();
  private subscribedNodes = new WeakSet<EmberTreeNode>();

  constructor(options: EmberServiceOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.disconnectTimeoutMs = options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;
    this.reconnectInitialMs = options.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.treeRefreshDebounceMs = options.treeRefreshDebounceMs ?? DEFAULT_TREE_REFRESH_DEBOUNCE_MS;
    this.incompleteStripRetryMs =
      options.incompleteStripRetryMs ?? DEFAULT_INCOMPLETE_STRIP_RETRY_MS;
    this.busDirectoryPollMs = options.busDirectoryPollMs ?? DEFAULT_BUS_DIRECTORY_POLL_MS;
    this.backoffMs = this.reconnectInitialMs;
    this.createClient = options.createClient ?? defaultEmberClientFactory;
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  get endpoint(): { host: string; port: number } {
    return { host: this.host, port: this.port };
  }

  get tree(): EmberCollection | undefined {
    return this.client?.tree;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.connectOnce();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.clearReconnectTimer();
    this.clearTreeRefreshTimer();
    this.clearIncompleteStripRetryTimer();
    this.clearBusDirectoryPollTimer();
    await this.safeClose();
    this.setStatus('disconnected');
  }

  async configure(host: string, port: number): Promise<void> {
    this.host = host;
    this.port = port;
    if (this.started) {
      await this.connectOnce();
    }
  }

  async refreshTree(stripDirectoryTimeoutMs?: number): Promise<void> {
    const client = this.requireClient();
    await this.expandTree(client, stripDirectoryTimeoutMs);
    if (!this.isActiveClient(client)) {
      return;
    }
    await this.watchStructure(client);
    if (!this.isActiveClient(client)) {
      return;
    }
    this.publishTree(client);
  }

  async subscribe(node: EmberTreeNode, onUpdate: (node: EmberTreeNode) => void): Promise<void> {
    if (this.subscribedNodes.has(node)) {
      return;
    }
    this.subscribedNodes.add(node);
    try {
      const client = this.requireClient();
      const request = await withTimeout(
        client.subscribe(node, onUpdate),
        this.timeoutMs,
        'subscribe',
      );
      if (request.response !== undefined) {
        await withTimeout(request.response, this.timeoutMs, 'subscribe response');
      }
    } catch (error) {
      this.subscribedNodes.delete(node);
      throw error;
    }
  }

  async setValue(node: EmberParameterNode, value: EmberValue): Promise<void> {
    await this.enqueueWrite(async () => {
      const client = this.requireClient();
      const request = await withTimeout(client.setValue(node, value), this.timeoutMs, 'setValue');
      if (request.response !== undefined) {
        await withTimeout(request.response, this.timeoutMs, 'setValue response');
      }
    });
  }

  async invoke(node: EmberFunctionNode): Promise<void> {
    await this.enqueueWrite(async () => {
      const client = this.requireClient();
      const request = await withTimeout(client.invoke(node), this.timeoutMs, 'invoke');
      if (request.sentOk === false) {
        throw new EmberProtocolError('Ember+ invoke was not sent');
      }
      // Fairlight executes reset without an InvocationResult; waiting hangs until timeout.
      if (request.response !== undefined) {
        void request.response.catch((error: unknown) => {
          this.logger.debug(
            { err: errorMessage(error), layer: 'protocol' },
            'invoke result ignored',
          );
        });
      }
    });
  }

  private async connectOnce(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.clearReconnectTimer();
    this.setStatus(this.hasConnected ? 'reconnecting' : 'connecting');
    await this.safeClose();
    const client = this.createBoundClient();
    this.client = client;
    this.bindClient(client);
    try {
      const result = await withTimeout(client.connect(), this.timeoutMs, 'connect');
      if (result instanceof Error) {
        throw result;
      }
      if (!this.isActiveClient(client)) {
        return;
      }
      await this.expandTree(client);
      if (!this.isActiveClient(client)) {
        return;
      }
      await this.watchStructure(client);
      if (!this.isActiveClient(client)) {
        return;
      }
      this.hasConnected = true;
      this.backoffMs = this.reconnectInitialMs;
      this.setStatus('connected');
      this.publishTree(client);
      this.startBusDirectoryPoll();
      if (this.busDirectoryPollMs > 0) {
        this.enqueueMixerStripReconcile();
      }
    } catch (error) {
      this.logger.error(
        { err: errorMessage(error), host: this.host, port: this.port, layer: 'protocol' },
        'ember connect failed',
      );
      if (this.client === client) {
        await this.safeClose();
      }
      if (this.started) {
        this.setStatus(this.hasConnected ? 'reconnecting' : 'connecting');
        this.scheduleReconnect();
      }
    }
  }

  private async expandTree(
    client: EmberClientHandle,
    stripDirectoryTimeoutMs?: number,
  ): Promise<void> {
    const { errors } = await expandEmberTree(client, {
      timeoutMs: this.timeoutMs,
      skipIdentifiers: SKIP_IDENTIFIERS,
      stripDirectoryTimeoutMs,
    });
    for (const error of errors) {
      this.logger.warn(
        { path: error.path, err: error.message, layer: 'protocol' },
        'tree expand error',
      );
    }
  }

  private async watchStructure(client: EmberClientHandle): Promise<void> {
    for (const root of Object.values(client.tree)) {
      if (!this.isActiveClient(client)) {
        return;
      }
      if (isParameterNode(root) || isFunctionNode(root)) {
        continue;
      }
      await this.watchNode(root);
      for (const child of childNodes(root)) {
        if (!this.isActiveClient(client)) {
          return;
        }
        if (isParameterNode(child) || isFunctionNode(child)) {
          continue;
        }
        await this.watchNode(child);
      }
    }
  }

  private async watchNode(node: EmberTreeNode): Promise<void> {
    try {
      await this.subscribe(node, () => {
        this.scheduleTreeRefresh();
      });
    } catch (error) {
      this.logger.warn(
        { err: errorMessage(error), layer: 'protocol' },
        'failed to watch tree structure',
      );
    }
  }

  private publishTree(client: EmberClientHandle): void {
    this.emit('tree', client.tree);
    this.scheduleIncompleteStripRetry(client);
  }

  private scheduleIncompleteStripRetry(client: EmberClientHandle): void {
    if (this.incompleteStripRetryMs <= 0 || !this.isActiveClient(client)) {
      return;
    }
    const pending = incompleteMixerStripKeys(client.tree);
    for (const key of [...this.retriedIncompleteStrips]) {
      if (!pending.includes(key)) {
        this.retriedIncompleteStrips.delete(key);
      }
    }
    const fresh = pending.filter((key) => !this.retriedIncompleteStrips.has(key));
    if (fresh.length === 0) {
      return;
    }
    for (const key of pending) {
      this.retriedIncompleteStrips.add(key);
    }
    this.clearIncompleteStripRetryTimer();
    this.incompleteStripRetryTimer = setTimeout(() => {
      this.incompleteStripRetryTimer = undefined;
      this.treeRefreshTail = this.treeRefreshTail.then(
        () => this.refreshTreeIfConnected(),
        () => this.refreshTreeIfConnected(),
      );
    }, this.incompleteStripRetryMs);
  }

  private scheduleTreeRefresh(): void {
    if (!this.started || this.client === undefined) {
      return;
    }
    if (this.treeRefreshTimer !== undefined) {
      clearTimeout(this.treeRefreshTimer);
    }
    this.treeRefreshTimer = setTimeout(() => {
      this.treeRefreshTimer = undefined;
      this.treeRefreshTail = this.treeRefreshTail.then(
        () => this.refreshTreeIfConnected(),
        () => this.refreshTreeIfConnected(),
      );
    }, this.treeRefreshDebounceMs);
  }

  private async refreshTreeIfConnected(): Promise<void> {
    if (!this.started || this.client === undefined || !this.client.connected) {
      return;
    }
    try {
      await this.refreshTree();
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'tree refresh failed');
    }
  }

  private enqueueMixerStripReconcile(): void {
    if (this.mixerProbeInFlight) {
      return;
    }
    this.treeRefreshTail = this.treeRefreshTail.then(
      () => this.reconcileMixerStripsIfConnected(),
      () => this.reconcileMixerStripsIfConnected(),
    );
  }

  private async reconcileMixerStripsIfConnected(): Promise<void> {
    const primary = this.client;
    if (this.mixerProbeInFlight || !this.started || primary === undefined || !primary.connected) {
      return;
    }
    this.mixerProbeInFlight = true;
    const probe = this.createClient(this.host, this.port, this.timeoutMs);
    try {
      const result = await withTimeout(probe.connect(), this.timeoutMs, 'probe connect');
      if (result instanceof Error) {
        throw result;
      }
      const { refs, errors } = await discoverMixerStripRefs(probe, { timeoutMs: this.timeoutMs });
      for (const error of errors) {
        this.logger.warn(
          { path: error.path, err: error.message, layer: 'protocol' },
          'strip probe error',
        );
      }
      if (!this.isActiveClient(primary)) {
        return;
      }
      const known = listMixerStripRefs(primary.tree);
      const knownKeys = new Set(known.map(mixerStripKey));
      const extra = refs.filter((ref) => !knownKeys.has(mixerStripKey(ref)));
      const added = attachMissingMixerStrips(primary.tree, refs);
      if (extra.length > 0 || added.length > 0 || known.length !== refs.length) {
        this.logger.info(
          {
            known: known.length,
            discovered: refs.length,
            extra: extra.map((ref) => `${mixerStripKey(ref)}#${ref.number}`),
            added: added.map((ref) => mixerStripKey(ref)),
            layer: 'protocol',
          },
          'mixer strip probe',
        );
      }
      if (added.length === 0) {
        return;
      }
      await this.refreshTree(this.timeoutMs);
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'mixer strip probe failed');
    } finally {
      if (probe !== primary) {
        try {
          await withTimeout(probe.disconnect(), this.disconnectTimeoutMs, 'probe disconnect');
        } catch {
          try {
            probe.discard();
          } catch {
            // The probe is discarded after a hung disconnect; nothing else to clean up.
          }
        }
      }
      this.mixerProbeInFlight = false;
    }
  }

  private bindClient(client: EmberClientHandle): void {
    const onDisconnected = (): void => {
      if (this.client !== client) {
        return;
      }
      this.logger.warn({ layer: 'protocol' }, 'ember socket disconnected');
      this.client = undefined;
      try {
        client.discard();
      } catch (error) {
        this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'discard failed');
      }
      if (this.started) {
        this.setStatus('reconnecting');
        this.scheduleReconnect();
        return;
      }
      this.setStatus('disconnected');
    };
    const onError = (error?: Error): void => {
      this.logger.error(
        { err: errorMessage(error ?? new Error('unknown ember client error')), layer: 'protocol' },
        'ember client error',
      );
    };
    client.on('disconnected', onDisconnected);
    client.on('error', onError);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || !this.started) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectOnce();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private clearTreeRefreshTimer(): void {
    if (this.treeRefreshTimer !== undefined) {
      clearTimeout(this.treeRefreshTimer);
      this.treeRefreshTimer = undefined;
    }
  }

  private clearIncompleteStripRetryTimer(): void {
    if (this.incompleteStripRetryTimer !== undefined) {
      clearTimeout(this.incompleteStripRetryTimer);
      this.incompleteStripRetryTimer = undefined;
    }
  }

  private startBusDirectoryPoll(): void {
    this.clearBusDirectoryPollTimer();
    if (this.busDirectoryPollMs <= 0 || !this.started) {
      return;
    }
    this.busDirectoryPollTimer = setInterval(() => {
      this.enqueueMixerStripReconcile();
    }, this.busDirectoryPollMs);
  }

  private clearBusDirectoryPollTimer(): void {
    if (this.busDirectoryPollTimer !== undefined) {
      clearInterval(this.busDirectoryPollTimer);
      this.busDirectoryPollTimer = undefined;
    }
  }

  private createBoundClient(): EmberClientHandle {
    const client = this.createClient(this.host, this.port, this.timeoutMs);
    patchEmberClientTreeMerge(client, {
      onChildrenAdded: () => {
        this.scheduleTreeRefresh();
      },
      onIncomingError: (error) => {
        this.logger.warn(
          { err: errorMessage(error), layer: 'protocol' },
          'ember tree update dropped',
        );
      },
    });
    return client;
  }

  private resetWatches(): void {
    this.subscribedNodes = new WeakSet();
    this.retriedIncompleteStrips.clear();
  }

  private async safeClose(): Promise<void> {
    this.clearTreeRefreshTimer();
    this.clearIncompleteStripRetryTimer();
    this.clearBusDirectoryPollTimer();
    this.resetWatches();
    const client = this.client;
    this.client = undefined;
    if (client === undefined) {
      return;
    }
    try {
      await withTimeout(client.disconnect(), this.disconnectTimeoutMs, 'disconnect');
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'disconnect timed out');
    }
    try {
      client.discard();
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'discard failed');
    }
  }

  private isActiveClient(client: EmberClientHandle): boolean {
    return this.started && this.client === client;
  }

  private requireClient(): EmberClientHandle {
    if (this.client === undefined || !this.client.connected) {
      throw new EmberProtocolError('Ember+ is not connected');
    }
    return this.client;
  }

  private enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(work, work);
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.statusValue === status) {
      return;
    }
    this.statusValue = status;
    this.emit('status', status);
  }
}

function defaultEmberClientFactory(
  host: string,
  port: number,
  timeoutMs: number,
): EmberClientHandle {
  // emberplus-connection arms S101 keepalive on its own once the TCP socket connects: it sends a
  // KeepAliveRequest every 10 s, answers the provider's requests, and closes the socket when a
  // response is missing for 500 ms. That close surfaces here as 'disconnected' and feeds the
  // reconnect backoff above. The library exposes no option for either value; see
  // apps/server/src/ember/keepalive.test.ts, which guards this behaviour across upgrades.
  const client = new EmberClient(host, port, timeoutMs);
  return client as unknown as EmberClientHandle;
}
