import type { View, ViewChannelRef } from '@flwc/shared';

/** Structural equality of two references; a missing key and an `undefined` value are equal. */
export function sameChannelReference(a: ViewChannelRef, b: ViewChannelRef): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.channelId === b.channelId &&
    a.groupId === b.groupId &&
    a.color === b.color
  );
}

/**
 * Reports whether the draft differs from the saved view: name, channel references (order and
 * every field), and groups (order, id, name) are compared structurally.
 */
export function isViewDirty(saved: View, draft: View): boolean {
  if (saved.name !== draft.name) {
    return true;
  }
  if (saved.channels.length !== draft.channels.length) {
    return true;
  }
  if (
    saved.channels.some((reference, index) => {
      const other = draft.channels[index];
      return other === undefined || !sameChannelReference(reference, other);
    })
  ) {
    return true;
  }
  if (saved.groups.length !== draft.groups.length) {
    return true;
  }
  return saved.groups.some((group, index) => {
    const other = draft.groups[index];
    return other === undefined || group.id !== other.id || group.name !== other.name;
  });
}
