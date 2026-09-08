import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { pickUp, press } from './keyboard-drag.js';
import { stubListLayout } from './stub-layout.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
    { id: 'aux/1', kind: 'aux', name: 'FX', levelDb: -8, muted: true, meterDb: -40 },
    { id: 'sub/1', kind: 'sub', name: 'SUB', levelDb: -10, muted: false, meterDb: -35 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const BASS = { kind: 'channel', name: 'BASS', channelId: 'channel/1' } as const;
const MAIN = { kind: 'main', name: 'MAIN', channelId: 'main/1' } as const;
const FX = { kind: 'aux', name: 'FX', channelId: 'aux/1' } as const;
const SUB = { kind: 'sub', name: 'SUB', channelId: 'sub/1' } as const;
const RHYTHM = { id: 'g1', name: 'Rhythm' };

async function openSettings(views: View[]) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient(views);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  const first = views[0];
  if (first !== undefined) {
    await screen.findByRole('option', { name: first.name });
  }
  fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
  const list = () => container.querySelector('.view-channel-list') as HTMLElement;
  const orderedNames = () =>
    [...container.querySelectorAll('.view-channel-list .channel-order-row')].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const memberNames = (groupId: string) =>
    [...container.querySelectorAll(`[data-view-group-id="${groupId}"] .channel-order-row`)].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const handle = (name: string) => within(list()).getByRole('button', { name: `Drag ${name}` });
  const availableHandle = (channelId: string) =>
    within(
      container.querySelector(`[data-available-channel-id="${channelId}"]`) as HTMLElement,
    ).getByRole('button', { name: /^Drag / });
  const savedChannels = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    await waitFor(() => expect(viewsClient.calls.at(-1)?.method).toBe('update'));
    return viewsClient.calls.at(-1)?.body?.channels;
  };
  return {
    container,
    viewsClient,
    list,
    orderedNames,
    memberNames,
    handle,
    availableHandle,
    savedChannels,
  };
}

const grouped: View = {
  id: 'v1',
  name: 'Stage',
  channels: [{ ...BASS, groupId: 'g1' }, { ...MAIN, groupId: 'g1' }, FX],
  groups: [RHYTHM],
};

describe('settings group collapse', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
    return () => restoreLayout();
  });

  it('folds a group shut and back open', async () => {
    const page = await openSettings([grouped]);
    const toggle = () => screen.getByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName('Expand group Rhythm');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(page.memberNames('g1')).toEqual([]);
    // The header keeps its member count, so the rows are hidden rather than gone.
    expect(within(page.list()).getByText('02 CH')).toBeInTheDocument();
    // The ungrouped row is untouched.
    expect(page.orderedNames()).toEqual(['FX']);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']);
  });

  it('gives an empty group no collapse button', async () => {
    await openSettings([{ id: 'v2', name: 'Empty', channels: [], groups: [RHYTHM] }]);
    expect(screen.queryByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ })).toBeNull();
    expect(screen.getByText('ASSIGN CHANNELS BELOW')).toBeInTheDocument();
  });

  it('forgets the collapsed groups when another view is selected', async () => {
    const other: View = { id: 'v2', name: 'Other', channels: [SUB], groups: [] };
    const page = await openSettings([grouped, other]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));
    expect(page.memberNames('g1')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    await waitFor(() => expect(page.orderedNames()).toEqual(['SUB']));
    fireEvent.click(screen.getByRole('button', { name: /Stage/ }));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']));
  });

  it('keeps every header control usable while a group is collapsed', async () => {
    const page = await openSettings([grouped]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));
    expect(page.memberNames('g1')).toEqual([]);

    // Renaming reaches the group and the collapse button follows the new name.
    fireEvent.change(screen.getByRole('textbox', { name: 'Group 1 name' }), {
      target: { value: 'Low End' },
    });
    expect(screen.getByRole('button', { name: 'Expand group Low End' })).toBeInTheDocument();

    // The arrow buttons still move the whole block.
    fireEvent.click(screen.getByRole('button', { name: 'Move group Low End down' }));
    expect(await page.savedChannels()).toEqual([
      FX,
      { ...BASS, groupId: 'g1' },
      { ...MAIN, groupId: 'g1' },
    ]);

    // UNGROUP releases the members in place and shows them again.
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Low End' }));
    expect(page.orderedNames()).toEqual(['FX', 'BASS', 'MAIN']);
  });

  it('moves a collapsed group as a whole with its handle', async () => {
    const page = await openSettings([grouped]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));

    await pickUp(page.handle('group Rhythm'));
    await press('ArrowDown');
    await press('Space');
    await waitFor(() =>
      expect(page.savedChannels()).resolves.toEqual([
        FX,
        { ...BASS, groupId: 'g1' },
        { ...MAIN, groupId: 'g1' },
      ]),
    );
  });

  it('opens a collapsed group as soon as a drag previews into it', async () => {
    const page = await openSettings([grouped]);
    const toggle = () => screen.getByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ });
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    // A collapsed group has no rows to stand for it, so it is a keyboard stop in its own right.
    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['FX', 'BASS', 'MAIN']);

    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['FX', 'BASS', 'MAIN']));
    // The group stays open after the drop.
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(await page.savedChannels()).toEqual([
      { ...FX, groupId: 'g1' },
      { ...BASS, groupId: 'g1' },
      { ...MAIN, groupId: 'g1' },
    ]);
  });
});
