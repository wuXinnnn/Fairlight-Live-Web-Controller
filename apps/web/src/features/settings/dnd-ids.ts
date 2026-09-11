import type { UniqueIdentifier } from '@dnd-kit/core';

/** Parsed form of a dnd-kit identifier used on the configuration page. */
export type DndId =
  | { kind: 'channel'; rowKey: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'groupzone'; groupId: string }
  | { kind: 'available'; channelId: string }
  | { kind: 'slot'; position: number; fill: boolean };

/**
 * Data attached to every draggable and droppable so collision detection and announcements can
 * reason about an item without parsing its identifier.
 */
export type DndItemData =
  | { kind: 'channel'; label: string; groupId?: string }
  | { kind: 'group'; label: string; groupId: string }
  | {
      kind: 'groupzone';
      label: string;
      groupId: string;
      empty: boolean;
      /** True while the group is collapsed, so its members are not rendered. */
      collapsed?: boolean;
    }
  | { kind: 'available'; label: string; channelId: string; groupId?: string }
  | {
      kind: 'slot';
      label: string;
      position: number;
      /** True when the dragged row already sits at this position. */
      current: boolean;
      /**
       * True for the slot that always sits at the end of the list and takes the space left
       * over. It is the only slot a whole group can be dropped on, because it is the only one
       * that is not a boundary a group could already be standing at.
       */
      fill: boolean;
    };

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

/**
 * Droppable id of a root slot: a place a channel can be dropped as an ungrouped row.
 * `position` counts the blocks before it. The `fill` slot at the end of the list is marked in
 * the identifier because it is the only one a whole group can be dropped on, and the drop
 * resolver has nothing but the identifier to go on.
 */
export function rootSlotDndId(position: number, fill = false): string {
  return fill ? `slot:fill:${position}` : `slot:${position}`;
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
    case 'slot': {
      const fill = rest.startsWith('fill:');
      const digits = fill ? rest.slice('fill:'.length) : rest;
      // Number('') is 0, so an identifier with nothing where the position should be would
      // otherwise parse as the top of the list.
      const position = digits.length === 0 ? Number.NaN : Number(digits);
      return Number.isInteger(position) && position >= 0 ? { kind: 'slot', position, fill } : null;
    }
    default:
      return null;
  }
}

const ITEM_KINDS: ReadonlySet<string> = new Set([
  'channel',
  'group',
  'groupzone',
  'available',
  'slot',
]);

/** Reads the item data dnd-kit carries on an active or over entry, or on a droppable container. */
export function readItemData(entry: { data?: { current?: unknown } } | null | undefined) {
  const data = entry?.data?.current;
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return undefined;
  }
  const kind = (data as { kind: unknown }).kind;
  return typeof kind === 'string' && ITEM_KINDS.has(kind) ? (data as DndItemData) : undefined;
}
