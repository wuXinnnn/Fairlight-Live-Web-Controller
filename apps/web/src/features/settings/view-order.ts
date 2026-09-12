import {
  viewChannelRefs,
  type ChannelPaletteKey,
  type View,
  type ViewChannelColor,
  type ViewChannelItem,
  type ViewChannelRef,
  type ViewGroup,
  type ViewGroupItem,
  type ViewItem,
} from '@flwc/shared';
import { sameViewItems } from './view-dirty.js';

export type MoveDirection = -1 | 1;

/**
 * A block is what the configuration page shows as one row group: a group with its members, or a
 * single ungrouped channel. Blocks are the view's items, so a group without members is a block
 * like any other and keeps its place in the order.
 */
export type ViewBlock =
  { kind: 'group'; group: ViewGroup; indices: number[] } | { kind: 'single'; index: number };

/**
 * Where a channel sits in the items: which item, and which member of it when that item is a
 * group. The page addresses rows by their flat index, and this is how that is resolved.
 */
export interface ChannelLocation {
  item: number;
  member?: number;
}

/** Where a dragged item lands. `position` counts members of the group, or top-level blocks. */
export type DropTarget =
  { kind: 'group'; groupId: string; position: number } | { kind: 'root'; position: number };

/** A completed placement: the new view, and the flat index the reference ended up at. */
export interface Placement {
  view: View;
  index: number;
}

function itemsWith(view: View, items: ViewItem[]): View {
  return { ...view, items };
}

function countOf(item: ViewItem): number {
  return item.type === 'channel' ? 1 : item.channels.length;
}

/** The items as blocks, with each group block carrying the flat indices of its members. */
export function viewBlocks(view: Pick<View, 'items'>): ViewBlock[] {
  let index = 0;
  return view.items.map((item) => {
    if (item.type === 'channel') {
      const block = { kind: 'single' as const, index };
      index += 1;
      return block;
    }
    const indices = item.channels.map(() => {
      const current = index;
      index += 1;
      return current;
    });
    return { kind: 'group' as const, group: item, indices };
  });
}

/** Resolves a flat channel index to the item that holds it; null when it is out of range. */
export function locateChannel(view: Pick<View, 'items'>, index: number): ChannelLocation | null {
  if (index < 0) {
    return null;
  }
  let seen = 0;
  for (let item = 0; item < view.items.length; item += 1) {
    const entry = view.items[item] as ViewItem;
    if (entry.type === 'channel') {
      if (seen === index) {
        return { item };
      }
      seen += 1;
      continue;
    }
    if (index < seen + entry.channels.length) {
      return { item, member: index - seen };
    }
    seen += entry.channels.length;
  }
  return null;
}

/** Flat index of the channel at `at`, counting the items before it. */
function flatIndexOf(view: Pick<View, 'items'>, at: ChannelLocation): number {
  let seen = 0;
  for (let item = 0; item < at.item; item += 1) {
    seen += countOf(view.items[item] as ViewItem);
  }
  return seen + (at.member ?? 0);
}

function itemAt(view: Pick<View, 'items'>, at: ChannelLocation): ViewItem | undefined {
  return view.items[at.item];
}

function referenceAt(view: Pick<View, 'items'>, at: ChannelLocation): ViewChannelRef | undefined {
  const item = itemAt(view, at);
  if (item === undefined) {
    return undefined;
  }
  return item.type === 'channel' ? item : item.channels[at.member ?? 0];
}

/** The group a flat index belongs to, or undefined when the row sits at the root. */
export function groupOfIndex(view: Pick<View, 'items'>, index: number): ViewGroup | undefined {
  const at = locateChannel(view, index);
  if (at === null) {
    return undefined;
  }
  const item = itemAt(view, at);
  return item?.type === 'group' ? item : undefined;
}

function groupIdAt(view: Pick<View, 'items'>, at: ChannelLocation): string | undefined {
  const item = itemAt(view, at);
  return item?.type === 'group' ? item.id : undefined;
}

function groupItemIndex(view: Pick<View, 'items'>, groupId: string): number {
  return view.items.findIndex((item) => item.type === 'group' && item.id === groupId);
}

/**
 * Removes the reference at `at`. A group that loses its last member stays behind as an empty
 * block: it still holds a position, and both the rendered list and the drop resolver count it.
 */
function removeAt(view: View, at: ChannelLocation): View {
  const item = itemAt(view, at);
  if (item === undefined) {
    return view;
  }
  if (item.type === 'channel') {
    return itemsWith(
      view,
      view.items.filter((_, candidate) => candidate !== at.item),
    );
  }
  const items = [...view.items];
  items[at.item] = {
    ...item,
    channels: item.channels.filter((_, candidate) => candidate !== at.member),
  };
  return itemsWith(view, items);
}

/** Takes item `from` out and puts it back at `position` among the rest; null for a no-op. */
function moveItemTo(view: View, from: number, position: number): View | null {
  const moved = view.items[from];
  if (moved === undefined) {
    return null;
  }
  const rest = view.items.filter((_, candidate) => candidate !== from);
  if (position < 0 || position > rest.length || position === from) {
    return null;
  }
  return itemsWith(view, [...rest.slice(0, position), moved, ...rest.slice(position)]);
}

/** A reference as a root-level item, without the `type` key a member must not carry. */
function asChannelItem(reference: ViewChannelRef): ViewChannelItem {
  return { ...reference, type: 'channel' };
}

/** A root-level item as a plain reference; members never carry a `type`. */
function asReference(reference: ViewChannelRef): ViewChannelRef {
  const next = { ...reference } as ViewChannelRef & { type?: unknown };
  delete next.type;
  return next;
}

/**
 * Moves a reference between groups and applies the colour rules that go with it: joining a group
 * turns an automatic colour into "follow the group", leaving one turns it back, and a colour
 * picked by hand is never touched. Moving inside the same group changes nothing.
 */
export function colorForMembership(
  reference: ViewChannelRef,
  from: string | undefined,
  to: string | undefined,
): ViewChannelRef {
  const next = asReference(reference);
  if (from === to) {
    return next;
  }
  if (to !== undefined && next.color === undefined) {
    next.color = 'group';
  } else if (to === undefined && next.color === 'group') {
    delete next.color;
  }
  return next;
}

/**
 * Inserts `moved` (already absent from `base`) at `target`, coming from group `from`. Root
 * positions count items, group positions count that group's members, so a reference only ever
 * lands on an item boundary or inside the run of its own group.
 */
function placeReference(
  base: View,
  moved: ViewChannelRef,
  from: string | undefined,
  target: DropTarget,
): Placement | null {
  if (target.kind === 'group') {
    const item = groupItemIndex(base, target.groupId);
    const group = base.items[item];
    if (group === undefined || group.type !== 'group') {
      return null;
    }
    if (target.position < 0 || target.position > group.channels.length) {
      return null;
    }
    const reference = colorForMembership(moved, from, group.id);
    const channels = [
      ...group.channels.slice(0, target.position),
      reference,
      ...group.channels.slice(target.position),
    ];
    const items = [...base.items];
    items[item] = { ...group, channels };
    return {
      view: itemsWith(base, items),
      index: flatIndexOf(base, { item, member: target.position }),
    };
  }
  if (target.position < 0 || target.position > base.items.length) {
    return null;
  }
  const reference = asChannelItem(colorForMembership(moved, from, undefined));
  const items = [
    ...base.items.slice(0, target.position),
    reference,
    ...base.items.slice(target.position),
  ];
  return { view: itemsWith(base, items), index: flatIndexOf(base, { item: target.position }) };
}

/**
 * Moves one channel. Grouped channels move within their group; ungrouped channels step over
 * neighbouring blocks. Returns null when the move is not possible.
 */
export function moveChannel(view: View, index: number, direction: MoveDirection): View | null {
  const at = locateChannel(view, index);
  if (at === null) {
    return null;
  }
  const item = itemAt(view, at);
  if (item?.type === 'group') {
    const member = at.member ?? 0;
    const target = member + direction;
    const neighbour = item.channels[target];
    const moved = item.channels[member];
    if (neighbour === undefined || moved === undefined) {
      return null;
    }
    const channels = [...item.channels];
    channels[member] = neighbour;
    channels[target] = moved;
    const items = [...view.items];
    items[at.item] = { ...item, channels };
    return itemsWith(view, items);
  }
  return moveItemTo(view, at.item, at.item + direction);
}

/** Moves a whole group block past the neighbouring block. Returns null when not possible. */
export function moveGroup(view: View, groupId: string, direction: MoveDirection): View | null {
  const from = groupItemIndex(view, groupId);
  return from < 0 ? null : moveItemTo(view, from, from + direction);
}

/**
 * Assigns a channel to a group (or removes it from one). The channel joins the end of the target
 * group's members, or lands right after the block it left when ungrouped.
 */
export function assignGroup(view: View, index: number, groupId: string | undefined): View {
  const at = locateChannel(view, index);
  if (at === null) {
    return view;
  }
  const from = groupIdAt(view, at);
  const moved = referenceAt(view, at);
  if (from === groupId || moved === undefined) {
    return view;
  }
  const base = removeAt(view, at);
  if (groupId !== undefined) {
    const item = groupItemIndex(base, groupId);
    const group = base.items[item];
    if (group === undefined || group.type !== 'group') {
      return view;
    }
    const target = { kind: 'group' as const, groupId, position: group.channels.length };
    return placeReference(base, moved, from, target)?.view ?? view;
  }
  // Leaving a group lands the row just after the block it came from, which is where it already
  // was; an ungrouped row that is not moving anywhere keeps its own place for the same reason.
  return placeReference(base, moved, from, { kind: 'root', position: at.item + 1 })?.view ?? view;
}

/** Adds an empty group at the end of the list. */
export function addGroup(view: View, group: Omit<ViewGroup, 'channels'>): View {
  return itemsWith(view, [...view.items, { ...group, type: 'group', channels: [] }]);
}

function mapGroup(
  view: View,
  groupId: string,
  update: (group: ViewGroupItem) => ViewGroupItem,
): View {
  return itemsWith(
    view,
    view.items.map((item) => (item.type === 'group' && item.id === groupId ? update(item) : item)),
  );
}

export function renameGroup(view: View, groupId: string, name: string): View {
  return mapGroup(view, groupId, (group) => ({ ...group, name }));
}

/** Dissolves a group; its members stay where they are, as ungrouped rows. */
export function removeGroup(view: View, groupId: string): View {
  const item = groupItemIndex(view, groupId);
  const group = view.items[item];
  if (group === undefined || group.type !== 'group') {
    return view;
  }
  const members = group.channels.map((reference) =>
    asChannelItem(colorForMembership(reference, groupId, undefined)),
  );
  return itemsWith(view, [...view.items.slice(0, item), ...members, ...view.items.slice(item + 1)]);
}

/** Overrides a group's colour, or clears the override so it follows its members' types. */
export function setGroupColor(view: View, groupId: string, color?: ChannelPaletteKey): View {
  return mapGroup(view, groupId, (group) => {
    const next = { ...group };
    if (color === undefined) {
      delete next.color;
    } else {
      next.color = color;
    }
    return next;
  });
}

/**
 * Root positions that need an explicit drop slot while an item is dragged: the boundaries where
 * a group starts the list or two groups touch. Every other boundary has an ungrouped row next to
 * it, which already offers its upper and lower half, and the end of the list has a slot of its
 * own that is always there. `blocks` are the blocks of the view without the dragged one, so the
 * slots do not move while the dragged row is previewed among them.
 */
export function rootSlotPositionsFor(blocks: ViewBlock[]): number[] {
  const positions: number[] = [];
  blocks.forEach((block, position) => {
    const previous = blocks[position - 1];
    if (block.kind === 'group' && (previous === undefined || previous.kind === 'group')) {
      positions.push(position);
    }
  });
  return positions;
}

/** `rootSlotPositionsFor` over the blocks of a view. */
export function rootSlotPositions(view: Pick<View, 'items'>): number[] {
  return rootSlotPositionsFor(viewBlocks(view));
}

/** Flat indices of the references that belong to `groupId`, in display order. */
export function memberIndices(view: Pick<View, 'items'>, groupId: string): number[] {
  const block = viewBlocks(view).find(
    (candidate) => candidate.kind === 'group' && candidate.group.id === groupId,
  );
  return block?.kind === 'group' ? block.indices : [];
}

/**
 * Moves the channel at `index` to `target`, joining or leaving a group as the target implies,
 * and reports where it landed. The source is removed before the target position is interpreted.
 * Returns null when the target is invalid or the move changes nothing.
 */
export function moveChannelToAt(view: View, index: number, target: DropTarget): Placement | null {
  const at = locateChannel(view, index);
  const moved = at === null ? undefined : referenceAt(view, at);
  if (at === null || moved === undefined) {
    return null;
  }
  const placed = placeReference(removeAt(view, at), moved, groupIdAt(view, at), target);
  if (placed === null || sameViewItems(placed.view, view)) {
    return null;
  }
  return placed;
}

/** `moveChannelToAt` without the landing index. */
export function moveChannelTo(view: View, index: number, target: DropTarget): View | null {
  return moveChannelToAt(view, index, target)?.view ?? null;
}

/**
 * Inserts a reference that is not yet in the view at `target`, reporting where it landed.
 * Returns null when a reference with the same kind, name and channel id already exists.
 */
export function insertChannelAtAt(
  view: View,
  reference: ViewChannelRef,
  target: DropTarget,
): Placement | null {
  const exists = viewChannelRefs(view).some(
    (candidate) =>
      candidate.kind === reference.kind &&
      candidate.name === reference.name &&
      candidate.channelId === reference.channelId,
  );
  if (exists) {
    return null;
  }
  return placeReference(view, reference, undefined, target);
}

/** `insertChannelAtAt` without the landing index. */
export function insertChannelAt(
  view: View,
  reference: ViewChannelRef,
  target: DropTarget,
): View | null {
  return insertChannelAtAt(view, reference, target)?.view ?? null;
}

/**
 * Moves a group block to `position` among the top-level blocks, counted with the group's own
 * block removed. Returns null for unknown groups, out-of-range positions and drops in place.
 */
export function moveGroupTo(view: View, groupId: string, position: number): View | null {
  const from = groupItemIndex(view, groupId);
  return from < 0 ? null : moveItemTo(view, from, position);
}

/** Removes the reference at `index`; null when the index is out of range. */
export function removeChannel(view: View, index: number): View | null {
  const at = locateChannel(view, index);
  return at === null ? null : removeAt(view, at);
}

/** Removes several references at once, by flat index. */
export function removeChannels(view: View, indices: ReadonlySet<number>): View {
  if (indices.size === 0) {
    return view;
  }
  let index = 0;
  const keep = (): boolean => {
    const drop = indices.has(index);
    index += 1;
    return !drop;
  };
  return itemsWith(
    view,
    view.items.flatMap<ViewItem>((item) => {
      if (item.type === 'channel') {
        return keep() ? [item] : [];
      }
      return [{ ...item, channels: item.channels.filter(keep) }];
    }),
  );
}

/** Appends a reference as the last row of the list. */
export function appendChannel(view: View, reference: ViewChannelRef): View {
  return itemsWith(view, [...view.items, asChannelItem(reference)]);
}

/** Sets or clears the colour override of the channel at `index`. */
export function setChannelColor(view: View, index: number, color?: ViewChannelColor): View {
  const at = locateChannel(view, index);
  const current = at === null ? undefined : referenceAt(view, at);
  if (at === null || current === undefined) {
    return view;
  }
  const next = asReference(current);
  if (color === undefined) {
    delete next.color;
  } else {
    next.color = color;
  }
  const item = itemAt(view, at);
  const items = [...view.items];
  if (item?.type === 'group') {
    items[at.item] = {
      ...item,
      channels: item.channels.map((reference, candidate) =>
        candidate === at.member ? next : reference,
      ),
    };
  } else {
    items[at.item] = asChannelItem(next);
  }
  return itemsWith(view, items);
}

/** Deletes a group together with every reference that belongs to it; null for unknown groups. */
export function removeGroupWithMembers(view: View, groupId: string): View | null {
  const item = groupItemIndex(view, groupId);
  if (item < 0) {
    return null;
  }
  return itemsWith(
    view,
    view.items.filter((_, candidate) => candidate !== item),
  );
}
