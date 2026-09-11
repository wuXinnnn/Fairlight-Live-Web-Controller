import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

/*
 * The delete button beside every row and group header, and the menu every control of a row folds
 * into once the CHANNEL ORDER column is too narrow to lay them out. jsdom evaluates no container
 * query, so both shapes are reachable here: the wide one through its buttons and comboboxes, the
 * narrow one through `<name> menu`. The menu's own items are options, which is why the names the
 * wide shape owns stay unambiguous.
 */

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
    { id: 'aux/1', kind: 'aux', name: 'FX', levelDb: -8, muted: true, meterDb: -40 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const BASS = { kind: 'channel', name: 'BASS', channelId: 'channel/1' } as const;
const MAIN = { kind: 'main', name: 'MAIN', channelId: 'main/1' } as const;
const FX = { kind: 'aux', name: 'FX', channelId: 'aux/1' } as const;
const RHYTHM = { id: 'g1', name: 'Rhythm' };

async function openSettings(view: View) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient([view]);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  await screen.findByRole('option', { name: view.name });
  fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
  const orderedNames = () =>
    [...container.querySelectorAll('.view-channel-list .channel-order-row')].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const memberNames = (groupId: string) =>
    [...container.querySelectorAll(`[data-view-group-id="${groupId}"] .channel-order-row`)].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const menu = (label: string) => screen.getByRole('combobox', { name: label });
  const pick = (label: string, command: string) =>
    fireEvent.change(menu(label), { target: { value: command } });
  const itemsOf = (label: string) =>
    [...menu(label).querySelectorAll('option')]
      .map((option) => option.textContent ?? '')
      .filter((text) => text !== '');
  const save = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    await waitFor(() => expect(viewsClient.calls.at(-1)?.method).toBe('update'));
    return viewsClient.calls.at(-1)?.body;
  };
  return { container, orderedNames, memberNames, menu, pick, itemsOf, save };
}

const loose: View = { id: 'v1', name: 'Stage', channels: [BASS, MAIN, FX], groups: [] };
const grouped: View = {
  id: 'v1',
  name: 'Stage',
  channels: [{ ...BASS, groupId: 'g1' }, { ...MAIN, groupId: 'g1' }, FX],
  groups: [RHYTHM],
};

beforeEach(() => {
  window.localStorage.clear();
  resetMixerStore();
  resetMeterStore();
  resetViewStore();
});

describe('settings delete button', () => {
  it('takes a channel out of the view and frees its checkbox again', async () => {
    const page = await openSettings(structuredClone(loose));
    fireEvent.click(screen.getByRole('button', { name: 'Remove MAIN' }));

    expect(page.orderedNames()).toEqual(['BASS', 'FX']);
    expect(screen.getByRole('checkbox', { name: /MAIN/ })).not.toBeChecked();
    expect((await page.save())?.channels).toEqual([BASS, FX]);
  });

  it('deletes a group together with its members', async () => {
    const page = await openSettings(structuredClone(grouped));
    fireEvent.click(screen.getByRole('button', { name: 'Delete group Rhythm' }));

    expect(page.orderedNames()).toEqual(['FX']);
    const saved = await page.save();
    expect(saved?.groups).toEqual([]);
    expect(saved?.channels).toEqual([FX]);
  });

  it('leaves the members behind when the same header is ungrouped instead', async () => {
    const page = await openSettings(structuredClone(grouped));
    // The two controls sit side by side and must not be mistaken for each other.
    expect(screen.getByRole('button', { name: 'Ungroup Rhythm' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Rhythm' }));

    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    const saved = await page.save();
    expect(saved?.groups).toEqual([]);
    expect(saved?.channels).toEqual([BASS, MAIN, FX]);
  });

  it('removes a missing reference, which the checklist cannot offer at all', async () => {
    const ghost = { kind: 'aux', name: 'GHOST', channelId: 'aux/9' } as const;
    const page = await openSettings({
      id: 'v1',
      name: 'Stage',
      channels: [BASS, ghost],
      groups: [],
    });
    const row = page.container.querySelector('[data-ordered-channel-name="GHOST"]') as HTMLElement;
    expect(row).toHaveTextContent('MISSING');
    // Nothing in AVAILABLE CHANNELS stands for it, so unchecking is not a way out.
    expect(page.container.querySelector('[data-available-channel-id="aux/9"]')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Remove GHOST' }));
    expect(page.orderedNames()).toEqual(['BASS']);
    expect((await page.save())?.channels).toEqual([BASS]);
  });
});

describe('settings row menu', () => {
  it('runs the row commands the narrow column hides', async () => {
    const page = await openSettings({ ...structuredClone(loose), groups: [RHYTHM] });

    page.pick('BASS menu', 'move:down');
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']);

    page.pick('BASS menu', 'group:g1');
    expect(page.memberNames('g1')).toEqual(['BASS']);
    expect(screen.getByRole('button', { name: 'BASS use group color' })).toHaveTextContent('GRP');

    page.pick('BASS menu', 'color:lime');
    expect(screen.getByRole('button', { name: 'BASS color Mix Minus Lime' })).toHaveClass(
      'is-selected',
    );
    // Joining a group moves the row to the end of that group's block, which is last here.
    expect((await page.save())?.channels).toEqual([
      MAIN,
      FX,
      { ...BASS, groupId: 'g1', color: 'lime' },
    ]);

    page.pick('BASS menu', 'delete');
    expect(page.orderedNames()).toEqual(['MAIN', 'FX']);
  });

  it('marks the choices in force and disables the moves it cannot make', async () => {
    const page = await openSettings({ id: 'v1', name: 'Stage', channels: [BASS], groups: [] });
    const options = [...page.menu('BASS menu').querySelectorAll('option')];
    const named = (text: string) => options.find((option) => option.textContent === text);

    expect(named('MOVE UP')).toBeDisabled();
    expect(named('MOVE DOWN')).toBeDisabled();
    expect(named('• NO GROUP')).toBeDefined();
    expect(named('• AUTO')).toBeDefined();
    // Without a group there is nothing for GRP to follow, in either shape.
    expect(page.itemsOf('BASS menu')).not.toContain('GRP');

    page.pick('BASS menu', 'color:red');
    expect(page.itemsOf('BASS menu')).toContain('• Main Red');
    expect((await page.save())?.channels).toEqual([{ ...BASS, color: 'red' }]);
  });

  it('recolours and ungroups a group through its own menu', async () => {
    const page = await openSettings(structuredClone(grouped));
    expect(page.itemsOf('Group Rhythm menu')).toContain('• AUTO');

    page.pick('Group Rhythm menu', 'color:purple');
    expect(screen.getByRole('button', { name: 'Group Rhythm color Matrix Purple' })).toHaveClass(
      'is-selected',
    );
    expect(page.itemsOf('Group Rhythm menu')).toContain('• Matrix Purple');
    expect((await page.save())?.groups).toEqual([{ ...RHYTHM, color: 'purple' }]);

    page.pick('Group Rhythm menu', 'ungroup');
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    expect((await page.save())?.groups).toEqual([]);
  });

  it('moves and deletes a group through its own menu', async () => {
    const page = await openSettings(structuredClone(grouped));
    page.pick('Group Rhythm menu', 'move:down');
    expect(page.orderedNames()).toEqual(['FX', 'BASS', 'MAIN']);

    page.pick('Group Rhythm menu', 'delete');
    expect(page.orderedNames()).toEqual(['FX']);
    expect((await page.save())?.channels).toEqual([FX]);
  });
});
