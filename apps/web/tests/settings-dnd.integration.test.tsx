import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

async function openSettings(view: View) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient([view]);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  await screen.findByRole('option', { name: view.name });
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

describe('settings drag and drop (keyboard sensor)', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
  });

  afterEach(() => {
    restoreLayout();
  });

  it('reorders ungrouped rows and saves the new order', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']));
    expect(await page.savedChannels()).toEqual([MAIN, BASS, FX]);

    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']));
  });

  it('moves an ungrouped row into a group and a member back out', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    expect(page.container.querySelector('[data-view-group-id="g1"]')).toHaveClass('is-drop-target');
    await press('ArrowDown');
    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'BASS', 'FX']));
    expect(screen.getByRole('combobox', { name: 'BASS group' })).toHaveValue('g1');
    expect(page.container.querySelector('[data-view-group-id="g1"]')).not.toHaveClass(
      'is-drop-target',
    );
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...BASS, groupId: 'g1' },
      { ...FX, groupId: 'g1' },
    ]);

    // With no ungrouped row left, the keyboard path can only reorder inside the group.
    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    await press('ArrowUp');
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['FX', 'MAIN', 'BASS']));
    expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue('g1');
  });

  it('moves a member above the group so it leaves the group', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('MAIN'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']));
    expect(page.memberNames('g1')).toEqual(['FX']);
    expect(screen.getByRole('combobox', { name: 'MAIN group' })).toHaveValue('');
    expect(await page.savedChannels()).toEqual([MAIN, BASS, { ...FX, groupId: 'g1' }]);
  });

  it('moves a whole group with its drag handle', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('group Rhythm'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'BASS']));
    expect(screen.getByRole('button', { name: 'Move group Rhythm up' })).toBeDisabled();
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...FX, groupId: 'g1' },
      BASS,
    ]);
  });

  it('drops a row onto an empty group', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN],
      groups: [],
    });
    fireEvent.change(screen.getByLabelText('NEW GROUP'), { target: { value: 'Rhythm' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD GROUP' }));
    expect(screen.getByText('ASSIGN CHANNELS BELOW')).toBeInTheDocument();
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Space');
    await waitFor(() =>
      expect(screen.queryByText('ASSIGN CHANNELS BELOW')).not.toBeInTheDocument(),
    );
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS']);
    expect(screen.getByRole('combobox', { name: 'BASS group' })).toHaveValue(
      screen
        .getByRole('combobox', { name: 'BASS group' })
        .querySelector('option:last-child')
        ?.getAttribute('value'),
    );
  });

  it('drags available channels into the list and into a group', async () => {
    const page = await openSettings({
      id: 'partial',
      name: 'Partial',
      channels: [BASS, { ...MAIN, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    expect(page.availableHandle('main/1')).toBeDisabled();
    expect(page.availableHandle('channel/1')).toBeDisabled();
    expect(page.availableHandle('aux/1')).toBeEnabled();

    // A plain click on the handle is not a click on the label: the checkbox stays as it is.
    fireEvent.click(page.availableHandle('aux/1'));
    expect(screen.getByRole('checkbox', { name: 'FXAUX' })).not.toBeChecked();
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN']);

    await pickUp(page.availableHandle('aux/1'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'BASS', 'MAIN']));
    expect(screen.getByRole('checkbox', { name: 'FXAUX' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue('');
    expect(page.availableHandle('aux/1')).toBeDisabled();

    await pickUp(page.availableHandle('sub/1'));
    await press('ArrowDown');
    expect(page.container.querySelector('[data-view-group-id="g1"]')).toHaveClass('is-drop-target');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'BASS', 'SUB', 'MAIN']));
    expect(screen.getByRole('combobox', { name: 'SUB group' })).toHaveValue('g1');
    expect(await page.savedChannels()).toEqual([
      FX,
      BASS,
      { ...SUB, groupId: 'g1' },
      { ...MAIN, groupId: 'g1' },
    ]);
  });

  it('cancels with Escape and ignores drops without a target', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    const handle = page.handle('BASS');
    await pickUp(handle);
    await press('ArrowDown');
    await press('Escape');
    await waitFor(() => expect(handle).not.toHaveAttribute('aria-pressed'));
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);

    await pickUp(handle);
    await press('Space');
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    expect(page.viewsClient.calls.filter((call) => call.method === 'update')).toHaveLength(0);
  });

  it('keeps the arrow buttons and the GROUP dropdown working alongside drag and drop', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move FX up' }));
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN']);
    fireEvent.change(screen.getByRole('combobox', { name: 'BASS group' }), {
      target: { value: 'g1' },
    });
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN', 'BASS']);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Rhythm' }));
    expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']);
    expect(within(page.list()).getAllByRole('button', { name: /^Drag / })).toHaveLength(3);
  });
});
