import { EventEmitter } from 'node:events';
import { EmberClient } from 'emberplus-connection';
import type { ConnectionStatus } from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';
import {
  attachMissingMixerStrips,
  discoverMixerStripRefs,
  expandEmberTree,
  hasGhostMixerChildren,
  incompleteMixerStripKeys,
  listMixerStripRefs,
  mixerStripKey,
  withTimeout,
} from '../tools/expand-ember-tree.js';
import { EmberProtocolError } from './errors.js';
import { childNodes, isFunctionNode, isParameterNode } from './node-utils.js';
import { patchEmberClientTreeMerge } from './patch-ember-client.js';
import { captureEmberTransport, retireEmberTransport } from './retire-ember-client.js';
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
export const DEFAULT_RECONNECT_INITIAL_MS = 1_000;
export const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_TREE_REFRESH_DEBOUNCE_MS = 100;
const DEFAULT_INCOMPLETE_STRIP_RETRY_MS = 300;
/**
 * How often the mixer strip probe dials the desk when nothing else asks for it. Every probe is a
 * fresh TCP session that Fairlight Live admits at about two a second and never tidies up after a
 * FIN, so the period is minutes, not seconds; changes the desk does not push arrive through the
 * triggered probes long before this timer fires. Zero turns the probe off altogether.
 */
export const DEFAULT_BUS_DIRECTORY_POLL_MS = 60_000;
/** The least time between two probes, however many triggers arrive in between. */
export const PROBE_MIN_GAP_MS = 5_000;
const SKIP_IDENTIFIERS = ['sends'] as const;
const MAX_LAST_ERROR_LENGTH = 200;

/** Why a mixer strip probe was run. `connect` is the one right after the tree first expanded. */
export type ProbeReason = 'connect' | 'periodic' | 'children-added' | 'ghost' | 'incomplete';

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
  status: [status: ConnectionStatus, lastError?: string];
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
  private lastErrorValue: string | undefined;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private treeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private incompleteStripRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimerDueAt: number | undefined;
  private readonly pendingProbeReasons = new Set<ProbeReason>();
  private lastProbeAt: number | undefined;
  private mixerProbeQueued = false;
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

  /** Reason of the most recent failed connect attempt; undefined once connected or reconfigured. */
  get lastError(): string | undefined {
    return this.lastErrorValue;
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
    this.clearProbeTimer();
    await this.safeClose();
    this.setStatus('disconnected', undefined);
  }

  async configure(host: string, port: number): Promise<void> {
    this.host = host;
    this.port = port;
    // A failure recorded against the previous endpoint must not be shown while the new one dials.
    this.setStatus(this.statusValue, undefined);
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
    // Keep the previous failure visible while the retry is in flight.
    this.setStatus(this.hasConnected ? 'reconnecting' : 'connecting', this.lastErrorValue);
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
      this.setStatus('connected', undefined);
      this.publishTree(client);
      if (this.busDirectoryPollMs > 0) {
        this.enqueueMixerStripReconcile(['connect']);
      }
    } catch (error) {
      if (this.client !== client) {
        // A newer attempt (reconfigure or reconnect) replaced this one while it was dialling;
        // its outcome must not touch the status the newer attempt owns.
        this.logger.debug(
          { err: errorMessage(error), layer: 'protocol' },
          'stale ember connect attempt failed',
        );
        return;
      }
      this.logger.error(
        { err: errorMessage(error), host: this.host, port: this.port, layer: 'protocol' },
        'ember connect failed',
      );
      await this.safeClose();
      if (this.started) {
        this.setStatus(
          this.hasConnected ? 'reconnecting' : 'connecting',
          connectFailureReason(error),
        );
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
    // What the tree itself says is missing: a ghost child the desk pushed without an identifier,
    // or a named strip still without level/mute/name. Both are what the probe is for.
    if (hasGhostMixerChildren(client.tree)) {
      this.requestMixerStripProbe('ghost');
    }
    if (incompleteMixerStripKeys(client.tree).length > 0) {
      this.requestMixerStripProbe('incomplete');
    }
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

  /**
   * Asks for a probe because of `reason`. It runs once the minimum gap since the last probe has
   * passed; reasons arriving before then are folded into that one run. With the probe off it does
   * nothing, and while a probe is queued or in flight it only records the reason.
   */
  private requestMixerStripProbe(reason: ProbeReason): void {
    if (this.busDirectoryPollMs <= 0 || !this.started || this.client === undefined) {
      return;
    }
    this.pendingProbeReasons.add(reason);
    this.armProbeTimer();
  }

  /**
   * One timer covers both the periodic probe and the triggered one: whichever is due first. An
   * existing timer is only replaced when the new due time is earlier, so a trigger can pull the
   * next probe forward but nothing can push it back.
   */
  private armProbeTimer(): void {
    if (
      this.busDirectoryPollMs <= 0 ||
      !this.started ||
      this.client === undefined ||
      this.mixerProbeQueued ||
      this.mixerProbeInFlight
    ) {
      return;
    }
    const now = Date.now();
    const since = this.lastProbeAt ?? now;
    const periodicAt = since + this.busDirectoryPollMs;
    const triggeredAt =
      this.pendingProbeReasons.size > 0
        ? Math.max(now, since + PROBE_MIN_GAP_MS)
        : Number.POSITIVE_INFINITY;
    const dueAt = Math.min(periodicAt, triggeredAt);
    if (this.probeTimer !== undefined) {
      if (this.probeTimerDueAt !== undefined && this.probeTimerDueAt <= dueAt) {
        return;
      }
      clearTimeout(this.probeTimer);
    }
    this.probeTimerDueAt = dueAt;
    this.probeTimer = setTimeout(
      () => {
        this.probeTimer = undefined;
        this.probeTimerDueAt = undefined;
        const reasons: ProbeReason[] =
          this.pendingProbeReasons.size > 0 ? [...this.pendingProbeReasons] : ['periodic'];
        this.pendingProbeReasons.clear();
        this.enqueueMixerStripReconcile(reasons);
      },
      Math.max(0, dueAt - now),
    );
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== undefined) {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
    this.probeTimerDueAt = undefined;
    this.pendingProbeReasons.clear();
    this.lastProbeAt = undefined;
  }

  private enqueueMixerStripReconcile(reasons: readonly ProbeReason[]): void {
    if (this.mixerProbeQueued || this.mixerProbeInFlight) {
      return;
    }
    this.mixerProbeQueued = true;
    this.treeRefreshTail = this.treeRefreshTail.then(
      () => this.reconcileMixerStripsIfConnected(reasons),
      () => this.reconcileMixerStripsIfConnected(reasons),
    );
  }

  private async reconcileMixerStripsIfConnected(reasons: readonly ProbeReason[]): Promise<void> {
    this.mixerProbeQueued = false;
    const primary = this.client;
    if (this.mixerProbeInFlight || !this.started || primary === undefined || !primary.connected) {
      return;
    }
    this.mixerProbeInFlight = true;
    const startedAt = Date.now();
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
      const discoveredKeys = new Set(refs.map(mixerStripKey));
      const extra = refs.filter((ref) => !knownKeys.has(mixerStripKey(ref)));
      const missing = known.filter((ref) => !discoveredKeys.has(mixerStripKey(ref)));
      const added = attachMissingMixerStrips(primary.tree, refs);
      const summary = {
        known: known.length,
        discovered: refs.length,
        extra: extra.map((ref) => `${mixerStripKey(ref)}#${ref.number}`),
        missing: missing.map((ref) => mixerStripKey(ref)),
        added: added.map((ref) => mixerStripKey(ref)),
        layer: 'protocol',
      };
      if (refs.length < known.length) {
        // Fewer than the live tree has. Either the desk dropped strips without saying so, or the
        // probe listed a bus directory before all of it arrived; both deserve a look.
        this.logger.warn(summary, 'mixer strip probe');
      } else if (extra.length > 0 || added.length > 0) {
        this.logger.info(summary, 'mixer strip probe');
      }
      this.logger.debug(
        {
          reasons,
          durationMs: Date.now() - startedAt,
          known: known.length,
          discovered: refs.length,
          added: added.length,
          layer: 'protocol',
        },
        'mixer strip probe finished',
      );
      if (added.length === 0) {
        return;
      }
      await this.refreshTree(this.timeoutMs);
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'mixer strip probe failed');
    } finally {
      if (probe !== primary) {
        /*
         * The probe is closed with a TCP reset, not a FIN: Fairlight Live never closes its side
         * of a session that was ended politely, and every such session stays in CLOSE_WAIT on the
         * desk, holding a handle, until the desk restarts.
         *
         * The order is fixed. The transport is captured first because `discard()` deletes the
         * client's own reference to it. It is retired (reset) before `discard()` because
         * `discard()` calls the library's `disconnect()`, which would send the FIN; retiring
         * clears the transport's socket, and `disconnect()` returns at once when there is none.
         * `discard()` still runs last, always: an EmberClient starts a resend interval in its
         * constructor and only `discard()` clears it. A soak run found that leak by watching the
         * server's handle count climb by five every ten seconds.
         */
        const transport = captureEmberTransport(probe);
        retireEmberTransport(transport, { reset: true });
        try {
          probe.discard();
        } catch {
          // Nothing else to clean up if the client objects to being discarded.
        }
      }
      this.lastProbeAt = Date.now();
      this.mixerProbeInFlight = false;
      this.armProbeTimer();
    }
  }

  private bindClient(client: EmberClientHandle): void {
    const onDisconnected = (): void => {
      if (this.client !== client) {
        return;
      }
      this.logger.warn({ layer: 'protocol' }, 'ember socket disconnected');
      this.client = undefined;
      const transport = captureEmberTransport(client);
      try {
        client.discard();
      } catch (error) {
        this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'discard failed');
      }
      retireEmberTransport(transport);
      if (this.started) {
        this.setStatus('reconnecting', this.lastErrorValue);
        this.scheduleReconnect();
        return;
      }
      this.setStatus('disconnected', this.lastErrorValue);
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

  private createBoundClient(): EmberClientHandle {
    const client = this.createClient(this.host, this.port, this.timeoutMs);
    patchEmberClientTreeMerge(client, {
      onChildrenAdded: () => {
        this.scheduleTreeRefresh();
        // A numbered directory update brought a new child; the desk may have more to tell a
        // fresh connection than it pushed to this one.
        this.requestMixerStripProbe('children-added');
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
    this.clearProbeTimer();
    this.resetWatches();
    const client = this.client;
    this.client = undefined;
    if (client === undefined) {
      return;
    }
    const transport = captureEmberTransport(client);
    // A client that never reached the mixer has no session to close, and disconnecting a
    // dialling socket only resolves once the dial gives up; retiring the transport is enough.
    if (client.connected) {
      try {
        await withTimeout(client.disconnect(), this.disconnectTimeoutMs, 'disconnect');
      } catch (error) {
        this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'disconnect timed out');
      }
    }
    try {
      client.discard();
    } catch (error) {
      this.logger.warn({ err: errorMessage(error), layer: 'protocol' }, 'discard failed');
    }
    // The library would otherwise keep this client dialling in the background.
    retireEmberTransport(transport);
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

  private setStatus(status: ConnectionStatus, lastError: string | undefined): void {
    if (this.statusValue === status && this.lastErrorValue === lastError) {
      return;
    }
    this.statusValue = status;
    this.lastErrorValue = lastError;
    this.emit('status', status, lastError);
  }
}

/**
 * Condenses a connect failure into one short line for the connection panel, e.g.
 * `connect ECONNREFUSED 10.0.0.8:9000` or `Timeout after 5000ms: connect`.
 */
export function connectFailureReason(error: unknown): string {
  const cause =
    error instanceof AggregateError && error.errors.length > 0 ? error.errors[0] : error;
  const message = errorMessage(cause).replace(/\s+/g, ' ').trim();
  if (message.length === 0) {
    return 'Connection failed';
  }
  return message.length > MAX_LAST_ERROR_LENGTH
    ? `${message.slice(0, MAX_LAST_ERROR_LENGTH - 1)}…`
    : message;
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
