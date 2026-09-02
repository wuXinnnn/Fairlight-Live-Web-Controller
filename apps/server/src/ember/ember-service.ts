import { EventEmitter } from 'node:events';
import { EmberClient } from 'emberplus-connection';
import type { ConnectionStatus } from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';
import { expandEmberTree, withTimeout } from '../tools/expand-ember-tree.js';
import { EmberProtocolError } from './errors.js';
import { childNodes, isFunctionNode, isParameterNode } from './node-utils.js';
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
  private readonly createClient: EmberClientFactory;
  private client: EmberClientHandle | undefined;
  private started = false;
  private hasConnected = false;
  private statusValue: ConnectionStatus = 'disconnected';
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private treeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
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

  async refreshTree(): Promise<void> {
    const client = this.requireClient();
    await this.expandTree(client);
    if (!this.isActiveClient(client)) {
      return;
    }
    await this.watchStructure(client);
    if (!this.isActiveClient(client)) {
      return;
    }
    this.emit('tree', client.tree);
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
    const client = this.createClient(this.host, this.port, this.timeoutMs);
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
      this.emit('tree', client.tree);
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

  private async expandTree(client: EmberClientHandle): Promise<void> {
    const { errors } = await expandEmberTree(client, {
      timeoutMs: this.timeoutMs,
      skipIdentifiers: SKIP_IDENTIFIERS,
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

  private resetWatches(): void {
    this.subscribedNodes = new WeakSet();
  }

  private async safeClose(): Promise<void> {
    this.clearTreeRefreshTimer();
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
