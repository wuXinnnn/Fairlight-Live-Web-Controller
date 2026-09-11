import {
  viewChannelRefs,
  type ChannelKind,
  type ChannelState,
  type View,
  type ViewChannelRef,
  type ViewGroup,
} from '@flwc/shared';

export interface ResolvedViewChannel {
  reference: ViewChannelRef;
  /** The live channel this reference currently maps to, or undefined when it is missing. */
  channel: ChannelState | undefined;
  /** Position of the reference in the view's flat channel order. */
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
  view: Pick<View, 'items'>,
  channels: ChannelState[],
): ResolvedViewChannel[] {
  const references = viewChannelRefs(view);
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
  const resolved: Array<ChannelState | undefined> = references.map(() => undefined);

  // Pass one: exact matches on kind, name, and last known id win first.
  references.forEach((reference, index) => {
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
  references.forEach((reference, index) => {
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

  return references.map((reference, index) => ({
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

export interface ViewSegment {
  /** The group shared by every entry, or undefined for a run of ungrouped channels. */
  group: ViewGroup | undefined;
  entries: ResolvedViewChannel[];
}

/**
 * Splits resolved view entries into segments that mirror the items: each group becomes one
 * segment (rendered like an All Channels type section) and the ungrouped rows between them form
 * flat segments. A group with no members produces no segment, so the mixer never shows one.
 */
export function segmentViewChannels(
  view: Pick<View, 'items'>,
  entries: ResolvedViewChannel[],
): ViewSegment[] {
  const segments: ViewSegment[] = [];
  let index = 0;
  const take = (count: number): ResolvedViewChannel[] => {
    const taken = entries.slice(index, index + count);
    index += count;
    return taken;
  };
  for (const item of view.items) {
    if (item.type === 'channel') {
      const [entry] = take(1);
      if (entry === undefined) {
        continue;
      }
      const last = segments[segments.length - 1];
      if (last !== undefined && last.group === undefined) {
        last.entries.push(entry);
      } else {
        segments.push({ group: undefined, entries: [entry] });
      }
      continue;
    }
    const members = take(item.channels.length);
    if (members.length > 0) {
      segments.push({ group: item, entries: members });
    }
  }
  return segments;
}
