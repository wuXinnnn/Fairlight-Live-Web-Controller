import type { ChannelPaletteKey, View, ViewChannelRef, ViewGroup } from '@flwc/shared';
import { sameChannelReference } from './view-dirty.js';

export type MoveDirection = -1 | 1;

/**
 * A block is what the configuration page shows as one row group: either a contiguous run of
 * channels that share a group, or a single ungrouped channel. Groups without members are
 * listed after the channels so they stay visible until a channel is assigned.
 */
export type ViewBlock =
  { kind: 'group'; group: ViewGroup; indices: number[] } | { kind: 'single'; index: number };

function groupById(view: View, groupId: string | undefined): ViewGroup | undefined {
  return groupId === undefined ? undefined : view.groups.find((group) => group.id === groupId);
}

/** Splits `view.channels` into blocks in display order, followed by empty groups. */
export function viewBlocks(view: View): ViewBlock[] {
  const blocks: ViewBlock[] = [];
  const seenGroups = new Set<string>();
  view.channels.forEach((reference, index) => {
    const group = groupById(view, reference.groupId);
    if (group === undefined) {
      blocks.push({ kind: 'single', index });
      return;
    }
    seenGroups.add(group.id);
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'group' && last.group.id === group.id) {
      last.indices.push(index);
    } else {
      blocks.push({ kind: 'group', group, indices: [index] });
    }
  });
  for (const group of view.groups) {
    if (!seenGroups.has(group.id)) {
      blocks.push({ kind: 'group', group, indices: [] });
    }
  }
  return blocks;
}

function blockIndices(block: ViewBlock): number[] {
  return block.kind === 'group' ? block.indices : [block.index];
}

function flatten(view: View, blocks: ViewBlock[]): View {
  const channels = blocks.flatMap((block) =>
    blockIndices(block).map((index) => view.channels[index] as ViewChannelRef),
  );
  return { ...view, channels };
}

function swapBlocks(view: View, blocks: ViewBlock[], from: number, to: number): View | null {
  if (to < 0 || to >= blocks.length) {
    return null;
  }
  const target = blocks[to] as ViewBlock;
  if (target.kind === 'group' && target.indices.length === 0) {
    return null;
  }
  const next = [...blocks];
  [next[from], next[to]] = [target, blocks[from] as ViewBlock];
  return flatten(view, next);
}

/**
 * Moves one channel. Grouped channels move within their group; ungrouped channels step over
 * neighbouring blocks. Returns null when the move is not possible.
 */
export function moveChannel(view: View, index: number, direction: MoveDirection): View | null {
  const reference = view.channels[index];
  if (reference === undefined) {
    return null;
  }
  const group = groupById(view, reference.groupId);
  if (group !== undefined) {
    const target = index + direction;
    const neighbour = view.channels[target];
    if (neighbour === undefined || neighbour.groupId !== group.id) {
      return null;
    }
    const channels = [...view.channels];
    channels[index] = neighbour;
    channels[target] = reference;
    return { ...view, channels };
  }
  const blocks = viewBlocks(view);
  const position = blocks.findIndex((block) => block.kind === 'single' && block.index === index);
  return swapBlocks(view, blocks, position, position + direction);
}

/** Moves a whole group block past the neighbouring block. Returns null when not possible. */
export function moveGroup(view: View, groupId: string, direction: MoveDirection): View | null {
  const blocks = viewBlocks(view);
  const position = blocks.findIndex(
    (block) => block.kind === 'group' && block.group.id === groupId && block.indices.length > 0,
  );
  if (position < 0) {
    return null;
  }
  return swapBlocks(view, blocks, position, position + direction);
}

/**
 * Moves a reference into `groupId` (or out of every group) and applies the colour rules that go
 * with it: joining a group turns an automatic colour into "follow the group", leaving one turns
 * it back, and a colour picked by hand is never touched. Moving inside the same group changes
 * nothing. It always returns a fresh object, because the drag preview locates the moved
 * reference by identity.
 */
export function colorForMembership(
  reference: ViewChannelRef,
  groupId: string | undefined,
): ViewChannelRef {
  const next: ViewChannelRef = { ...reference };
  const joined = groupId !== undefined && reference.groupId !== groupId;
  const left = groupId === undefined && reference.groupId !== undefined;
  if (groupId === undefined) {
    delete next.groupId;
  } else {
    next.groupId = groupId;
  }
  if (joined && next.color === undefined) {
    next.color = 'group';
  } else if (left && next.color === 'group') {
    delete next.color;
  }
  return next;
}

/**
 * Assigns a channel to a group (or removes it from one). The channel joins the end of the
 * target group's run, or lands right after its former group when ungrouped.
 */
export function assignGroup(view: View, index: number, groupId: string | undefined): View {
  const reference = view.channels[index];
  if (reference === undefined || reference.groupId === groupId) {
    return view;
  }
  const remaining = view.channels.filter((_, candidate) => candidate !== index);
  const moved = colorForMembership(reference, groupId);
  const anchorGroup = groupId ?? reference.groupId;
  let insertAt = remaining.length;
  for (let candidate = remaining.length - 1; candidate >= 0; candidate -= 1) {
    if (remaining[candidate]?.groupId === anchorGroup) {
      insertAt = candidate + 1;
      break;
    }
  }
  if (groupId === undefined && insertAt === remaining.length) {
    // Former group has no other members: keep the channel where it was.
    insertAt = index;
  }
  const channels = [...remaining.slice(0, insertAt), moved, ...remaining.slice(insertAt)];
  return { ...view, channels };
}

export function addGroup(view: View, group: ViewGroup): View {
  return { ...view, groups: [...view.groups, group] };
}

export function renameGroup(view: View, groupId: string, name: string): View {
  return {
    ...view,
    groups: view.groups.map((group) => (group.id === groupId ? { ...group, name } : group)),
  };
}

/** Deletes a group; its members stay in place as ungrouped channels. */
export function removeGroup(view: View, groupId: string): View {
  return {
    ...view,
    groups: view.groups.filter((group) => group.id !== groupId),
    channels: view.channels.map((reference) =>
      reference.groupId === groupId ? colorForMembership(reference, undefined) : reference,
    ),
  };
}

/** Overrides a group's colour, or clears the override so it follows its first present member. */
export function setGroupColor(view: View, groupId: string, color?: ChannelPaletteKey): View {
  return {
    ...view,
    groups: view.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }
      const next = { ...group };
      if (color === undefined) {
        delete next.color;
      } else {
        next.color = color;
      }
      return next;
    }),
  };
}

/** Where a dragged channel lands. `position` counts members of the group, or top-level blocks. */
export type DropTarget =
  { kind: 'group'; groupId: string; position: number } | { kind: 'root'; position: number };

/** Blocks that take part in top-level ordering: singles and groups that have members. */
export function nonEmptyBlocks(view: View): ViewBlock[] {
  return viewBlocks(view).filter((block) => block.kind === 'single' || block.indices.length > 0);
}

/**
 * Root positions that need an explicit drop slot while a channel is dragged: the boundaries
 * where a group starts the list, two groups touch, or a group ends the list. Every other block
 * boundary has an ungrouped row next to it, which already offers its upper and lower half.
 * `blocks` are the ordered blocks of the view without the dragged channel, so the slots (and the
 * positions they resolve to) do not move while the dragged row is previewed among them.
 */
export function rootSlotPositionsFor(blocks: ViewBlock[]): number[] {
  const positions: number[] = [];
  blocks.forEach((block, position) => {
    const previous = blocks[position - 1];
    if (block.kind === 'group' && (previous === undefined || previous.kind === 'group')) {
      positions.push(position);
    }
  });
  if (blocks[blocks.length - 1]?.kind === 'group') {
    positions.push(blocks.length);
  }
  return positions;
}

/** `rootSlotPositionsFor` over the non-empty blocks of a view. */
export function rootSlotPositions(view: View): number[] {
  return rootSlotPositionsFor(nonEmptyBlocks(view));
}

/** Indices of the references that belong to `groupId`, in channel order. */
export function memberIndices(view: View, groupId: string): number[] {
  return view.channels.flatMap((reference, index) =>
    reference.groupId === groupId ? [index] : [],
  );
}

function firstIndexOf(block: ViewBlock): number {
  return block.kind === 'single' ? block.index : (block.indices[0] ?? 0);
}

/**
 * Inserts `moved` into `base` (which must not contain it) at `target`. Root positions count the
 * non-empty blocks of `base`, group positions count that group's members, so the reference only
 * ever lands on a block boundary or inside its own group's run and runs stay contiguous.
 */
function placeReference(base: View, moved: ViewChannelRef, target: DropTarget): View | null {
  let reference: ViewChannelRef;
  let at: number;
  if (target.kind === 'group') {
    const group = groupById(base, target.groupId);
    if (group === undefined) {
      return null;
    }
    const members = memberIndices(base, group.id);
    if (target.position < 0 || target.position > members.length) {
      return null;
    }
    reference = colorForMembership(moved, group.id);
    const last = members[members.length - 1];
    const slot = members[target.position];
    at =
      last === undefined
        ? base.channels.length
        : target.position === members.length
          ? last + 1
          : (slot ?? base.channels.length);
  } else {
    const blocks = nonEmptyBlocks(base);
    if (target.position < 0 || target.position > blocks.length) {
      return null;
    }
    reference = colorForMembership(moved, undefined);
    const block = blocks[target.position];
    at = block === undefined ? base.channels.length : firstIndexOf(block);
  }
  const channels = [...base.channels.slice(0, at), reference, ...base.channels.slice(at)];
  return { ...base, channels };
}

function sameChannels(a: View, b: View): boolean {
  return (
    a.channels.length === b.channels.length &&
    a.channels.every((reference, index) => {
      const other = b.channels[index];
      return other !== undefined && sameChannelReference(reference, other);
    })
  );
}

/**
 * Moves `view.channels[index]` to `target`, joining or leaving a group as the target implies.
 * The source is removed before the target position is interpreted. Returns null when the target
 * is invalid or the move changes nothing.
 */
export function moveChannelTo(view: View, index: number, target: DropTarget): View | null {
  const reference = view.channels[index];
  if (reference === undefined) {
    return null;
  }
  const base = { ...view, channels: view.channels.filter((_, candidate) => candidate !== index) };
  const next = placeReference(base, reference, target);
  if (next === null || sameChannels(next, view)) {
    return null;
  }
  return next;
}

/**
 * Inserts a reference that is not yet in the view at `target`. Returns null when a reference
 * with the same kind, name and channel id already exists.
 */
export function insertChannelAt(
  view: View,
  reference: ViewChannelRef,
  target: DropTarget,
): View | null {
  const exists = view.channels.some(
    (candidate) =>
      candidate.kind === reference.kind &&
      candidate.name === reference.name &&
      candidate.channelId === reference.channelId,
  );
  if (exists) {
    return null;
  }
  return placeReference(view, reference, target);
}

/**
 * Moves a non-empty group block to `position` among the top-level blocks, counted with the
 * group's own block removed. Returns null for empty or unknown groups, out-of-range positions
 * and drops in place.
 */
export function moveGroupTo(view: View, groupId: string, position: number): View | null {
  const blocks = nonEmptyBlocks(view);
  const from = blocks.findIndex((block) => block.kind === 'group' && block.group.id === groupId);
  if (from < 0) {
    return null;
  }
  const rest = blocks.filter((_, candidate) => candidate !== from);
  if (position < 0 || position > rest.length || position === from) {
    return null;
  }
  const moved = blocks[from] as ViewBlock;
  return flatten(view, [...rest.slice(0, position), moved, ...rest.slice(position)]);
}

/** Removes the reference at `index`; null when the index is out of range. */
export function removeChannel(view: View, index: number): View | null {
  if (view.channels[index] === undefined) {
    return null;
  }
  return { ...view, channels: view.channels.filter((_, candidate) => candidate !== index) };
}

/** Deletes a group together with every reference that belongs to it; null for unknown groups. */
export function removeGroupWithMembers(view: View, groupId: string): View | null {
  if (!view.groups.some((group) => group.id === groupId)) {
    return null;
  }
  return {
    ...view,
    groups: view.groups.filter((group) => group.id !== groupId),
    channels: view.channels.filter((reference) => reference.groupId !== groupId),
  };
}
