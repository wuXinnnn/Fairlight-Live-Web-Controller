import type { UniqueIdentifier } from '@dnd-kit/core';

/** Parsed form of a dnd-kit identifier used on the configuration page. */
export type DndId =
  | { kind: 'channel'; rowKey: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'groupzone'; groupId: string }
  | { kind: 'available'; channelId: string };

/**
 * Data attached to every draggable and droppable so collision detection and announcements can
 * reason about an item without parsing its identifier.
 */
export type DndItemData =
  | { kind: 'channel'; label: string; groupId?: string }
  | { kind: 'group'; label: string; groupId: string }
  | { kind: 'groupzone'; label: string; groupId: string; empty: boolean }
  | { kind: 'available'; label: string; channelId: string };

export type DndItemKind = DndItemData['kind'];

/** Sortable item id of a channel row; `rowKey` comes from `channelRowKeys`. */
export function channelDndId(rowKey: string): string {
  return `channel:${rowKey}`;
}

/** Sortable item id of a group block with members. */
export function groupDndId(groupId: string): string {
  return `group:${groupId}`;
}

/**
 * Droppable id of a group container. It is separate from the sortable item id because
 * `useSortable` already registers a droppable under the item id.
 */
export function groupZoneDndId(groupId: string): string {
  return `groupzone:${groupId}`;
}

/** Draggable id of an entry in the AVAILABLE CHANNELS list. */
export function availableDndId(channelId: string): string {
  return `available:${channelId}`;
}

/** Splits an identifier on its first colon; anything unknown yields null. */
export function parseDndId(id: UniqueIdentifier): DndId | null {
  const text = String(id);
  const separator = text.indexOf(':');
  if (separator < 0) {
    return null;
  }
  const prefix = text.slice(0, separator);
  const rest = text.slice(separator + 1);
  if (rest.length === 0) {
    return null;
  }
  switch (prefix) {
    case 'channel':
      return { kind: 'channel', rowKey: rest };
    case 'group':
      return { kind: 'group', groupId: rest };
    case 'groupzone':
      return { kind: 'groupzone', groupId: rest };
    case 'available':
      return { kind: 'available', channelId: rest };
    default:
      return null;
  }
}

const ITEM_KINDS: ReadonlySet<string> = new Set(['channel', 'group', 'groupzone', 'available']);

/** Reads the item data dnd-kit carries on an active or over entry, or on a droppable container. */
export function readItemData(entry: { data?: { current?: unknown } } | null | undefined) {
  const data = entry?.data?.current;
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return undefined;
  }
  const kind = (data as { kind: unknown }).kind;
  return typeof kind === 'string' && ITEM_KINDS.has(kind) ? (data as DndItemData) : undefined;
}
