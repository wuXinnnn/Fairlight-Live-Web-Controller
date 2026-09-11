import type { ChannelKind, ChannelState, View, ViewChannelRef, ViewGroup } from '@flwc/shared';

export interface ResolvedViewChannel {
  reference: ViewChannelRef;
  /** The live channel this reference currently maps to, or undefined when it is missing. */
  channel: ChannelState | undefined;
  /** Position of the reference inside `view.channels`. */
  index: number;
}

export function channelNameKey(kind: ChannelKind, name: string): string {
  return `${kind}\u0000${name.trim()}`;
}

/**
 * Resolves view references against the live channel inventory by channel kind and trimmed
 * name. Fairlight Live renumbers strips when channels are inserted or reordered, so the
 * logical channel id is only used to break ties between live channels that share a name.
 * Each live channel is claimed by at most one reference; unresolved references are missing.
 */
export function resolveViewChannels(
  view: Pick<View, 'channels'>,
  channels: ChannelState[],
): ResolvedViewChannel[] {
  const candidatesByKey = new Map<string, ChannelState[]>();
  for (const channel of channels) {
    const key = channelNameKey(channel.kind, channel.name);
    const bucket = candidatesByKey.get(key);
    if (bucket === undefined) {
      candidatesByKey.set(key, [channel]);
    } else {
      bucket.push(channel);
    }
  }

  const claimed = new Set<string>();
  const resolved: Array<ChannelState | undefined> = view.channels.map(() => undefined);

  // Pass one: exact matches on kind, name, and last known id win first.
  view.channels.forEach((reference, index) => {
    if (reference.channelId === undefined) {
      return;
    }
    const match = candidatesByKey
      .get(channelNameKey(reference.kind, reference.name))
      ?.find((channel) => channel.id === reference.channelId && !claimed.has(channel.id));
    if (match !== undefined) {
      claimed.add(match.id);
      resolved[index] = match;
    }
  });

  // Pass two: remaining references take the first unclaimed channel with the same kind and name.
  view.channels.forEach((reference, index) => {
    if (resolved[index] !== undefined) {
      return;
    }
    const match = candidatesByKey
      .get(channelNameKey(reference.kind, reference.name))
      ?.find((channel) => !claimed.has(channel.id));
    if (match !== undefined) {
      claimed.add(match.id);
      resolved[index] = match;
    }
  });

  return view.channels.map((reference, index) => ({
    reference,
    channel: resolved[index],
    index,
  }));
}

/** Returns the `channelNameKey`s that more than one live channel shares. */
export function duplicateChannelNames(channels: ChannelState[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const channel of channels) {
    const key = channelNameKey(channel.kind, channel.name);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return duplicates;
}

/** Builds the reference stored in a view for a live channel picked in the configuration page. */
export function referenceForChannel(channel: ChannelState): ViewChannelRef {
  return { kind: channel.kind, name: channel.name, channelId: channel.id };
}

/**
 * Kind of the first entry that resolved to a live channel. A group with no colour of its own
 * takes the type colour of this channel, so members that follow the group all read the same.
 */
export function leadChannelKind(entries: ResolvedViewChannel[]): ChannelKind | undefined {
  return entries.find((entry) => entry.channel !== undefined)?.channel?.kind;
}

export interface ViewSegment {
  /** The group shared by every entry, or undefined for a run of ungrouped channels. */
  group: ViewGroup | undefined;
  entries: ResolvedViewChannel[];
}

/**
 * Splits resolved view entries into contiguous runs: each run of channels sharing a group
 * becomes one segment (rendered like an All Channels type section) and ungrouped channels
 * between them form flat segments.
 */
export function segmentViewChannels(
  view: Pick<View, 'groups'>,
  entries: ResolvedViewChannel[],
): ViewSegment[] {
  const segments: ViewSegment[] = [];
  for (const entry of entries) {
    const group = view.groups.find((candidate) => candidate.id === entry.reference.groupId);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.group?.id === group?.id) {
      last.entries.push(entry);
    } else {
      segments.push({ group, entries: [entry] });
    }
  }
  return segments;
}
