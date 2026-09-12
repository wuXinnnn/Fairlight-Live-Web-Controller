/**
 * Builders for the ordered-item view model, shared by the unit and integration tests so the
 * shape lives in one place. `channelRow` makes a root-level entry and `channelGroup` a block
 * with its members; a member is a plain reference and must not carry the root-level `type` key.
 */
import type { View, ViewChannelItem, ViewChannelRef, ViewGroupItem, ViewItem } from '@flwc/shared';

export function channelRow(reference: ViewChannelRef): ViewChannelItem {
  return { ...reference, type: 'channel' };
}

export function channelGroup(
  group: { id: string; name: string; color?: ViewGroupItem['color'] },
  channels: ViewChannelRef[] = [],
): ViewGroupItem {
  return { ...group, type: 'group', channels };
}

export function viewOf(id: string, name: string, items: ViewItem[] = []): View {
  return { id, name, items };
}
