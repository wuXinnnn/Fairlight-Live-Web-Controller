import { randomUUID } from 'node:crypto';
import type { ConnectionPutBody, ConnectionStatus, LoudnessState } from '@flwc/shared';
import type { View, ViewWriteBody } from '@flwc/shared';
import { ConfigStore } from './config/config-store.js';
import { EmberService } from './ember/ember-service.js';
import {
  isParameterNode,
  readBooleanValue,
  readNumericValue,
  readStringValue,
} from './ember/node-utils.js';
import { TreeMapper } from './ember/tree-mapper.js';
import type { EmberClientFactory, EmberCollection, EmberTreeNode } from './ember/types.js';
import type { AppLogger } from './logger.js';
import { MeterHub } from './state/meter-hub.js';
import { MixerStateStore } from './state/mixer-state-store.js';

export interface MixerRuntimeOptions {
  configPath: string;
  logger: AppLogger;
  host?: string;
  port?: number;
  timeoutMs?: number;
  disconnectTimeoutMs?: number;
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
  treeRefreshDebounceMs?: number;
  incompleteStripRetryMs?: number;
  createClient?: EmberClientFactory;
  meterIntervalMs?: number;
  onMeterFrame?: MeterHub['onFrame'];
}

export class ViewNotFoundError extends Error {
  constructor(id: string) {
    super(`View "${id}" was not found`);
    this.name = 'ViewNotFoundError';
  }
}

export class MixerRuntime {
  readonly store = new MixerStateStore();
  readonly mapper: TreeMapper;
  readonly ember: EmberService;
  readonly config: ConfigStore;
  readonly meters: MeterHub;
  private readonly logger: AppLogger;
  private started = false;
  private treeReady: Promise<void> = Promise.resolve();

  constructor(options: MixerRuntimeOptions) {
    this.logger = options.logger;
    this.mapper = new TreeMapper(options.logger);
    this.config = new ConfigStore(options.configPath, options.logger);
    this.ember = new EmberService({
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 1,
      logger: options.logger,
      timeoutMs: options.timeoutMs,
      disconnectTimeoutMs: options.disconnectTimeoutMs,
      reconnectInitialMs: options.reconnectInitialMs,
      reconnectMaxMs: options.reconnectMaxMs,
      treeRefreshDebounceMs: options.treeRefreshDebounceMs,
      incompleteStripRetryMs: options.incompleteStripRetryMs,
      createClient: options.createClient,
    });
    this.meters = new MeterHub(options.onMeterFrame ?? (() => undefined), options.meterIntervalMs);
    this.ember.on('status', (status: ConnectionStatus) => {
      this.store.setConnection(status);
    });
    this.ember.on('tree', (tree: EmberCollection) => {
      this.treeReady = this.treeReady.then(
        () => this.onTree(tree),
        () => this.onTree(tree),
      );
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    const config = await this.config.load();
    this.meters.start();
    await this.ember.configure(config.ember.host, config.ember.port);
    await this.ember.start();
    await this.treeReady;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.meters.stop();
    await this.ember.stop();
  }

  async updateEndpoint(endpoint: ConnectionPutBody): Promise<void> {
    await this.config.update((current) => ({
      ...current,
      ember: endpoint,
    }));
    await this.ember.configure(endpoint.host, endpoint.port);
  }

  listViews(): View[] {
    return this.config.snapshot.views;
  }

  async createView(body: ViewWriteBody): Promise<View> {
    const view: View = { id: randomUUID(), ...body };
    await this.config.update((current) => ({
      ...current,
      views: [...current.views, view],
    }));
    return view;
  }

  async updateView(id: string, body: ViewWriteBody): Promise<View> {
    const view: View = { id, ...body };
    await this.config.update((current) => {
      const index = current.views.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        throw new ViewNotFoundError(id);
      }
      const views = [...current.views];
      views[index] = view;
      return { ...current, views };
    });
    return view;
  }

  async deleteView(id: string): Promise<void> {
    await this.config.update((current) => {
      const index = current.views.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        throw new ViewNotFoundError(id);
      }
      return {
        ...current,
        views: current.views.filter((candidate) => candidate.id !== id),
      };
    });
  }

  async setLevel(id: string, levelDb: number): Promise<void> {
    const node = this.mapper.resolveParameter(id, 'level');
    await this.ember.setValue(node, levelDb);
    this.store.setLevel(id, levelDb);
  }

  async setOn(id: string, on: boolean): Promise<void> {
    const node = this.mapper.resolveParameter(id, 'mute');
    await this.ember.setValue(node, !on);
    this.store.setMuted(id, !on);
  }

  async resetLoudness(): Promise<void> {
    const node = this.mapper.resolveReset();
    await this.ember.invoke(node);
  }

  private async onTree(tree: EmberCollection): Promise<void> {
    const result = this.mapper.sync(tree);
    this.store.applySync(result);
    try {
      await this.subscribeMapped();
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error), layer: 'protocol' },
        'failed to subscribe mapped nodes',
      );
    }
  }

  private async subscribeMapped(): Promise<void> {
    for (const channel of this.mapper.list()) {
      await this.subscribeMappedNode(channel.level, (node) => {
        const value = numericFrom(node);
        if (value !== undefined) {
          this.store.setLevel(channel.id, value);
        }
      });
      await this.subscribeMappedNode(channel.mute, (node) => {
        const value = booleanFrom(node);
        if (value !== undefined) {
          this.store.setMuted(channel.id, value);
        }
      });
      await this.subscribeMappedNode(channel.name, (node) => {
        const value = stringFrom(node);
        if (value !== undefined) {
          this.store.setName(channel.id, value);
        }
      });
      if (channel.meter !== undefined) {
        await this.subscribeMappedNode(channel.meter, (node) => {
          const value = numericFrom(node);
          if (value !== undefined) {
            this.store.setMeterSilent(channel.id, value);
            this.meters.ingestMeter(channel.id, value);
          }
        });
      }
    }
    const loudness = this.mapper.getLoudness();
    if (loudness === undefined) {
      return;
    }
    await this.subscribeMappedNode(loudness.integrated, (node) => {
      const value = numericFrom(node);
      if (value !== undefined) {
        this.applyLoudness({ integratedLufs: value });
      }
    });
    await this.subscribeMappedNode(loudness.truePeak, (node) => {
      const value = numericFrom(node);
      if (value !== undefined) {
        this.applyLoudness({ truePeakDbtp: value });
      }
    });
  }

  private async subscribeMappedNode(
    node: EmberTreeNode,
    onUpdate: (node: EmberTreeNode) => void,
  ): Promise<void> {
    try {
      await this.ember.subscribe(node, onUpdate);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error), layer: 'protocol' },
        'failed to subscribe mapped node',
      );
    }
  }

  private applyLoudness(partial: Partial<LoudnessState>): void {
    this.store.setLoudnessSilent(partial);
    this.meters.ingestLoudness(this.store.loudness);
  }
}

function numericFrom(node: EmberTreeNode): number | undefined {
  return isParameterNode(node) ? readNumericValue(node) : undefined;
}

function booleanFrom(node: EmberTreeNode): boolean | undefined {
  return isParameterNode(node) ? readBooleanValue(node) : undefined;
}

function stringFrom(node: EmberTreeNode): string | undefined {
  return isParameterNode(node) ? readStringValue(node) : undefined;
}
