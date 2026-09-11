import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

/* The delete button beside every channel row and every group header. */

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
