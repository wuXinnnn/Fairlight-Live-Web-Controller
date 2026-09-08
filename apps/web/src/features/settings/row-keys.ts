import type { View, ViewChannelRef } from '@flwc/shared';

function referenceKey(reference: ViewChannelRef): string {
  return `${reference.kind}:${reference.name}:${reference.channelId ?? ''}`;
}

/**
 * One stable key per `view.channels` entry. Equal references (same kind, name and channel id)
 * are told apart by their occurrence ordinal, so a key follows its row while the row moves and
 * only changes when an earlier duplicate is removed.
 */
export function channelRowKeys(view: Pick<View, 'channels'>): string[] {
  const seen = new Map<string, number>();
  return view.channels.map((reference) => {
    const base = referenceKey(reference);
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return `${base}#${ordinal}`;
  });
}

/** Stable key of a group block; group ids are unique within a view. */
export function groupRowKey(groupId: string): string {
  return `group:${groupId}`;
}
