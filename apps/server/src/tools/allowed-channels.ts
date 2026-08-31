import type { DumpJsonValue, DumpNode } from './dump-types.js';

export const ALLOWED_FADER_CHANNEL_NAMES = [
  'MIC-REVERB',
  'BASS',
  'Anagram-Wet',
  'Anagram-Dry',
] as const;

export type AllowedFaderChannelName = (typeof ALLOWED_FADER_CHANNEL_NAMES)[number];

export interface ChannelLevelMatch {
  channelName: string;
  namePath: string;
  levelNumberPath: string;
  levelIdentifierPath: string;
  currentLevel: DumpJsonValue | undefined;
  minimum: number | null | undefined;
  maximum: number | null | undefined;
}

export function isAllowedFaderChannel(name: string): name is AllowedFaderChannelName {
  return (ALLOWED_FADER_CHANNEL_NAMES as readonly string[]).includes(name);
}

export function assertAllowedFaderChannel(name: string): AllowedFaderChannelName {
  if (!isAllowedFaderChannel(name)) {
    throw new Error(
      `Refusing to write channel "${name}". Allowed fader channels: ${ALLOWED_FADER_CHANNEL_NAMES.join(', ')}`,
    );
  }
  return name;
}

export function findChannelLevel(
  nodes: readonly DumpNode[],
  channelName: string,
): ChannelLevelMatch | undefined {
  const allowed = assertAllowedFaderChannel(channelName);
  return walkForChannelLevel(nodes, allowed);
}

function walkForChannelLevel(
  nodes: readonly DumpNode[],
  channelName: AllowedFaderChannelName,
): ChannelLevelMatch | undefined {
  for (const node of nodes) {
    const match =
      matchChannelAtNode(node, channelName) ??
      walkForChannelLevel(node.children ?? [], channelName);
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

function matchChannelAtNode(
  node: DumpNode,
  channelName: AllowedFaderChannelName,
): ChannelLevelMatch | undefined {
  const children = node.children ?? [];
  const nameChild = children.find(
    (child) => child.identifier === 'name' && child.value === channelName,
  );
  if (nameChild === undefined) {
    return undefined;
  }
  const levelChild = children.find((child) => child.identifier === 'level');
  if (levelChild === undefined) {
    return undefined;
  }
  return {
    channelName,
    namePath: nameChild.identifierPath,
    levelNumberPath: levelChild.numberPath,
    levelIdentifierPath: levelChild.identifierPath,
    currentLevel: levelChild.value,
    minimum: levelChild.minimum,
    maximum: levelChild.maximum,
  };
}

export function chooseWriteTarget(
  current: number,
  deltaDb: number,
  minimum?: number | null,
  maximum?: number | null,
): number {
  const candidate = current + deltaDb;
  if (minimum !== undefined && minimum !== null && candidate < minimum) {
    return current - deltaDb;
  }
  if (maximum !== undefined && maximum !== null && candidate > maximum) {
    return current - deltaDb;
  }
  return candidate;
}
