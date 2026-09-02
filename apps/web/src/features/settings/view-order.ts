import type { View, ViewChannelRef, ViewGroup } from '@flwc/shared';

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
 * Assigns a channel to a group (or removes it from one). The channel joins the end of the
 * target group's run, or lands right after its former group when ungrouped.
 */
export function assignGroup(view: View, index: number, groupId: string | undefined): View {
  const reference = view.channels[index];
  if (reference === undefined || reference.groupId === groupId) {
    return view;
  }
  const remaining = view.channels.filter((_, candidate) => candidate !== index);
  const moved: ViewChannelRef = { ...reference };
  if (groupId === undefined) {
    delete moved.groupId;
  } else {
    moved.groupId = groupId;
  }
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
    channels: view.channels.map((reference) => {
      if (reference.groupId !== groupId) {
        return reference;
      }
      const ungrouped = { ...reference };
      delete ungrouped.groupId;
      return ungrouped;
    }),
  };
}
