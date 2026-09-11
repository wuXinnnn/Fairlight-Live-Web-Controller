import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

/*
 * The palette renders as a row of buttons and as the menu it collapses into once the CHANNEL ORDER
 * column is too narrow for them. jsdom does not evaluate the container query that hides one of the
 * two, so both are reachable here; these cases drive the menu and assert it writes exactly what the
 * buttons write.
 */

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const BASS = { kind: 'channel', name: 'BASS', channelId: 'channel/1' } as const;
const MAIN = { kind: 'main', name: 'MAIN', channelId: 'main/1' } as const;

async function openSettings(views: View[]) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient(views);
  render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  const first = views[0];
  if (first !== undefined) {
    await screen.findByRole('option', { name: first.name });
  }
  fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
  const save = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    await waitFor(() => expect(viewsClient.calls.at(-1)?.method).toBe('update'));
    return viewsClient.calls.at(-1)?.body;
  };
  return { save };
}

const grouped: View = {
  id: 'v1',
  name: 'Stage',
  channels: [{ ...BASS, groupId: 'g1', color: 'group' }, MAIN],
  groups: [{ id: 'g1', name: 'Rhythm' }],
};

describe('settings palette menu', () => {
  it('sets a row colour through the menu the buttons collapse into', async () => {
    const page = await openSettings([structuredClone(grouped)]);
    const menu = screen.getByRole('combobox', { name: 'BASS color menu' });
    // The menu starts on whatever the row already follows.
    expect(menu).toHaveValue('group');

    fireEvent.change(menu, { target: { value: 'lime' } });
    expect(screen.getByRole('button', { name: 'BASS color Mix Minus Lime' })).toHaveClass(
      'is-selected',
    );
    expect((await page.save())?.channels).toEqual([
      { ...BASS, groupId: 'g1', color: 'lime' },
      MAIN,
    ]);

    fireEvent.change(menu, { target: { value: 'auto' } });
    expect(screen.getByRole('button', { name: 'BASS use default color' })).toHaveClass(
      'is-selected',
    );
    expect((await page.save())?.channels).toEqual([{ ...BASS, groupId: 'g1' }, MAIN]);

    fireEvent.change(menu, { target: { value: 'group' } });
    expect(screen.getByRole('button', { name: 'BASS use group color' })).toHaveClass('is-selected');
    expect((await page.save())?.channels).toEqual([
      { ...BASS, groupId: 'g1', color: 'group' },
      MAIN,
    ]);
  });

  it('sets a group colour through its own menu', async () => {
    const page = await openSettings([structuredClone(grouped)]);
    const menu = screen.getByRole('combobox', { name: 'Group Rhythm color menu' });
    expect(menu).toHaveValue('auto');

    fireEvent.change(menu, { target: { value: 'purple' } });
    expect(screen.getByRole('button', { name: 'Group Rhythm color Matrix Purple' })).toHaveClass(
      'is-selected',
    );
    expect((await page.save())?.groups).toEqual([{ id: 'g1', name: 'Rhythm', color: 'purple' }]);

    fireEvent.change(menu, { target: { value: 'auto' } });
    expect(screen.getByRole('button', { name: 'Group Rhythm use automatic color' })).toHaveClass(
      'is-selected',
    );
    expect((await page.save())?.groups).toEqual([{ id: 'g1', name: 'Rhythm' }]);
  });

  it('offers no group choice to a row that has no group', async () => {
    await openSettings([{ id: 'v1', name: 'Stage', channels: [BASS, MAIN], groups: [] }]);
    const menu = screen.getByRole('combobox', { name: 'BASS color menu' });
    expect([...menu.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'AUTO',
      'Input Green',
      'Main Red',
      'Sub Teal',
      'Aux Navy',
      'Mix Minus Lime',
      'Matrix Purple',
    ]);
  });
});
