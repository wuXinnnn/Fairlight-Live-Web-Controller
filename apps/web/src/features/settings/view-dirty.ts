import type { View, ViewChannelRef, ViewItem } from '@flwc/shared';

/** Structural equality of two references; a missing key and an `undefined` value are equal. */
export function sameChannelReference(a: ViewChannelRef, b: ViewChannelRef): boolean {
  return (
    a.kind === b.kind && a.name === b.name && a.channelId === b.channelId && a.color === b.color
  );
}

function sameItem(a: ViewItem, b: ViewItem): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === 'channel' || b.type === 'channel') {
    return sameChannelReference(a as ViewChannelRef, b as ViewChannelRef);
  }
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color === b.color &&
    a.channels.length === b.channels.length &&
    a.channels.every((reference, index) => {
      const other = b.channels[index];
      return other !== undefined && sameChannelReference(reference, other);
    })
  );
}

/**
 * Structural equality of two views' items: the order of the blocks, what each block is, and
 * every field of every reference. An empty group counts like any other block, so moving one is
 * a change even though no channel went anywhere.
 */
export function sameViewItems(a: Pick<View, 'items'>, b: Pick<View, 'items'>): boolean {
  return (
    a.items.length === b.items.length &&
    a.items.every((item, index) => {
      const other = b.items[index];
      return other !== undefined && sameItem(item, other);
    })
  );
}

/** Reports whether the draft differs from the saved view, by name or by structure. */
export function isViewDirty(saved: View, draft: View): boolean {
  return saved.name !== draft.name || !sameViewItems(saved, draft);
}
