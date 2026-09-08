import { describe, expect, it } from 'vitest';
import {
  availableDndId,
  channelDndId,
  groupDndId,
  groupZoneDndId,
  parseDndId,
  readItemData,
  rootSlotDndId,
} from './dnd-ids.js';

describe('dnd ids', () => {
  it('round-trips every identifier kind, splitting on the first colon only', () => {
    expect(parseDndId(channelDndId('channel:BASS:channel/1#0'))).toEqual({
      kind: 'channel',
      rowKey: 'channel:BASS:channel/1#0',
    });
    expect(parseDndId(groupDndId('g1'))).toEqual({ kind: 'group', groupId: 'g1' });
    expect(parseDndId(groupZoneDndId('g1'))).toEqual({ kind: 'groupzone', groupId: 'g1' });
    expect(parseDndId(availableDndId('aux/1'))).toEqual({ kind: 'available', channelId: 'aux/1' });
    expect(parseDndId(rootSlotDndId(2))).toEqual({ kind: 'slot', position: 2 });
  });

  it('rejects identifiers it does not know', () => {
    expect(parseDndId('nonsense')).toBeNull();
    expect(parseDndId('other:thing')).toBeNull();
    expect(parseDndId('channel:')).toBeNull();
    expect(parseDndId('slot:x')).toBeNull();
    expect(parseDndId('slot:-1')).toBeNull();
    expect(parseDndId('slot:1.5')).toBeNull();
    expect(parseDndId(42)).toBeNull();
  });

  it('reads item data only when it carries a known kind', () => {
    expect(
      readItemData({ data: { current: { kind: 'group', label: 'group A', groupId: 'a' } } }),
    ).toEqual({ kind: 'group', label: 'group A', groupId: 'a' });
    expect(readItemData({ data: { current: { sortable: {} } } })).toBeUndefined();
    expect(readItemData({ data: { current: { kind: 'other' } } })).toBeUndefined();
    expect(readItemData({ data: { current: null } })).toBeUndefined();
    expect(readItemData(null)).toBeUndefined();
  });
});
