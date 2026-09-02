import {
  CHANNEL_KINDS,
  DEFAULT_METER_DB,
  defaultLoudnessState,
  type ChannelKind,
  type ChannelState,
  type LoudnessState,
} from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { ChannelNotFoundError } from './errors.js';
import {
  childNodes,
  findChildByIdentifier,
  isFunctionNode,
  isNodeOnline,
  isParameterNode,
  readBooleanValue,
  readIdentifier,
  readNumericValue,
  readStringValue,
} from './node-utils.js';
import type {
  EmberCollection,
  EmberFunctionNode,
  EmberParameterNode,
  EmberTreeNode,
} from './types.js';

const BUS_KIND_SET = new Set<string>(CHANNEL_KINDS);

export interface MappedChannel {
  id: string;
  kind: ChannelKind;
  level: EmberParameterNode;
  mute: EmberParameterNode;
  name: EmberParameterNode;
  meter: EmberParameterNode | undefined;
}

export interface MappedLoudness {
  integrated: EmberParameterNode;
  truePeak: EmberParameterNode;
  reset: EmberFunctionNode;
}

export interface TreeSyncResult {
  added: ChannelState[];
  updated: ChannelState[];
  removedIds: string[];
  loudness: LoudnessState | undefined;
  structureChanged: boolean;
}

export class TreeMapper {
  private readonly channels = new Map<string, MappedChannel>();
  private loudness: MappedLoudness | undefined;

  constructor(private readonly logger: AppLogger) {}

  sync(tree: EmberCollection): TreeSyncResult {
    const discovered = new Map<string, MappedChannel>();
    let discoveredLoudness: MappedLoudness | undefined;

    for (const root of Object.values(tree)) {
      const identifier = readIdentifier(root);
      if (identifier === undefined) {
        this.logger.debug({ number: root.number }, 'ignoring root without identifier');
        continue;
      }
      if (identifier === 'system') {
        discoveredLoudness = this.findLoudness(root);
        continue;
      }
      if (isChannelKind(identifier)) {
        if (!isNodeOnline(root)) {
          this.logger.debug({ identifier }, 'ignoring offline bus root');
          continue;
        }
        this.walkBus(root, identifier, discovered);
        continue;
      }
      this.logger.debug({ identifier }, 'ignoring unrecognized root node');
    }

    const added: ChannelState[] = [];
    const updated: ChannelState[] = [];
    const removedIds: string[] = [];

    for (const [id, mapped] of discovered) {
      const state = toChannelState(mapped);
      const previous = this.channels.get(id);
      if (previous === undefined) {
        added.push(state);
      } else if (!sameChannelState(toChannelState(previous), state)) {
        updated.push(state);
      }
    }
    for (const id of this.channels.keys()) {
      if (!discovered.has(id)) {
        removedIds.push(id);
      }
    }

    this.channels.clear();
    for (const [id, mapped] of discovered) {
      this.channels.set(id, mapped);
    }
    this.loudness = discoveredLoudness;

    return {
      added,
      updated,
      removedIds,
      loudness: discoveredLoudness === undefined ? undefined : toLoudnessState(discoveredLoudness),
      structureChanged: added.length > 0 || removedIds.length > 0,
    };
  }

  get(id: string): MappedChannel | undefined {
    return this.channels.get(id);
  }

  list(): MappedChannel[] {
    return [...this.channels.values()];
  }

  getLoudness(): MappedLoudness | undefined {
    return this.loudness;
  }

  resolveParameter(id: string, field: 'level' | 'mute' | 'name' | 'meter'): EmberParameterNode {
    const mapped = this.channels.get(id);
    if (mapped === undefined) {
      throw new ChannelNotFoundError(id);
    }
    if (field === 'meter') {
      if (mapped.meter === undefined) {
        throw new ChannelNotFoundError(id);
      }
      return mapped.meter;
    }
    return mapped[field];
  }

  resolveReset(): EmberFunctionNode {
    if (this.loudness === undefined) {
      throw new ChannelNotFoundError('loudness');
    }
    return this.loudness.reset;
  }

  private walkBus(
    root: EmberTreeNode,
    kind: ChannelKind,
    discovered: Map<string, MappedChannel>,
  ): void {
    const pattern = new RegExp(`^${kind}(\\d+)$`);
    for (const child of childNodes(root)) {
      const identifier = readIdentifier(child);
      if (identifier === undefined) {
        this.logger.debug({ kind, number: child.number }, 'ignoring strip without identifier');
        continue;
      }
      if (!isNodeOnline(child)) {
        this.logger.debug({ identifier, kind }, 'ignoring offline strip');
        continue;
      }
      const match = pattern.exec(identifier);
      if (match === null) {
        this.logger.debug({ identifier, kind }, 'ignoring unrecognized strip');
        continue;
      }
      const mapped = this.mapStrip(child, kind, match[1] ?? identifier);
      if (mapped !== undefined) {
        discovered.set(mapped.id, mapped);
      }
    }
  }

  private mapStrip(
    node: EmberTreeNode,
    kind: ChannelKind,
    instance: string,
  ): MappedChannel | undefined {
    const level = asParameter(findChildByIdentifier(node, 'level'));
    const mute = asParameter(findChildByIdentifier(node, 'mute'));
    const name = asParameter(findChildByIdentifier(node, 'name'));
    if (level === undefined || mute === undefined || name === undefined) {
      this.logger.warn(
        { kind, instance, layer: 'protocol' },
        'skipping strip missing level, mute, or name',
      );
      return undefined;
    }
    return {
      id: `${kind}/${instance}`,
      kind,
      level,
      mute,
      name,
      meter: asParameter(findChildByIdentifier(node, 'meter')),
    };
  }

  private findLoudness(system: EmberTreeNode): MappedLoudness | undefined {
    const loudness = findChildByIdentifier(system, 'loudness');
    if (loudness === undefined) {
      this.logger.debug({ identifier: 'system' }, 'system root has no loudness node');
      return undefined;
    }
    const integrated = asParameter(findChildByIdentifier(loudness, 'integrated'));
    const truePeak = asParameter(findChildByIdentifier(loudness, 'true-peak'));
    const resetNode = findChildByIdentifier(loudness, 'reset');
    const reset = resetNode !== undefined && isFunctionNode(resetNode) ? resetNode : undefined;
    if (integrated === undefined || truePeak === undefined || reset === undefined) {
      this.logger.warn({ layer: 'protocol' }, 'loudness node is missing required children');
      return undefined;
    }
    return { integrated, truePeak, reset };
  }
}

function isChannelKind(identifier: string): identifier is ChannelKind {
  return BUS_KIND_SET.has(identifier);
}

function asParameter(node: EmberTreeNode | undefined): EmberParameterNode | undefined {
  if (node === undefined || !isParameterNode(node)) {
    return undefined;
  }
  return node;
}

export function toChannelState(mapped: MappedChannel): ChannelState {
  return {
    id: mapped.id,
    kind: mapped.kind,
    name: readStringValue(mapped.name) ?? mapped.id,
    levelDb: readNumericValue(mapped.level) ?? 0,
    muted: readBooleanValue(mapped.mute) ?? false,
    meterDb:
      mapped.meter === undefined
        ? DEFAULT_METER_DB
        : (readNumericValue(mapped.meter) ?? DEFAULT_METER_DB),
  };
}

function toLoudnessState(mapped: MappedLoudness): LoudnessState {
  const defaults = defaultLoudnessState();
  return {
    integratedLufs: readNumericValue(mapped.integrated) ?? defaults.integratedLufs,
    truePeakDbtp: readNumericValue(mapped.truePeak) ?? defaults.truePeakDbtp,
  };
}

function sameChannelState(left: ChannelState, right: ChannelState): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.levelDb === right.levelDb &&
    left.muted === right.muted &&
    left.meterDb === right.meterDb
  );
}
