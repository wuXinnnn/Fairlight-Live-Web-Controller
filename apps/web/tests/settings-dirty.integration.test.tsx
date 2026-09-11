import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { channelGroup as grp, channelRow as row } from './view-fixtures.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
    { id: 'aux/1', kind: 'aux', name: 'FX', levelDb: -8, muted: true, meterDb: -40 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const grouped: View = {
  id: 'grouped',
  name: 'Grouped',
  items: [
    grp({ id: 'g1', name: 'Rhythm' }, [
      { kind: 'channel', name: 'BASS', channelId: 'channel/1' },
      { kind: 'main', name: 'MAIN', channelId: 'main/1' },
    ]),
  ],
};

const other: View = {
  id: 'other',
  name: 'Other',
  items: [row({ kind: 'aux', name: 'FX', channelId: 'aux/1' })],
};

async function openSettings() {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient([grouped, other]);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  await screen.findByRole('option', { name: 'Grouped' });
  fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
  return { container, viewsClient };
}

const memberNames = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-view-group-id="g1"] .channel-order-row')].map(
    (row) => (row as HTMLElement).dataset.orderedChannelName,
  );
const saveButton = () => screen.getByRole('button', { name: 'SAVE VIEW' });
const viewButton = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const dialog = () => screen.getByRole('dialog', { name: 'UNSAVED CHANGES' });
const noDialog = () => expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
const makeDirty = () => fireEvent.click(screen.getByRole('button', { name: 'Move MAIN up' }));
const rename = (name: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: name } });
/** Simulates a traversal to an entry the router stamped with `routeIndex`. */
const traverseTo = (routeIndex: number, path = '/') =>
  act(() => {
    window.history.pushState({ routeIndex }, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
// The app mounts on entry 0 (the mixer); CONFIGURE VIEWS pushes entry 1.
const goBack = () => traverseTo(0);
const goForward = () => traverseTo(2);
const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('settings unsaved changes', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the three dirty indicators until a save succeeds and keeps them when it fails', async () => {
    const { container, viewsClient } = await openSettings();
    expect(saveButton()).not.toHaveClass('is-dirty');
    expect(screen.queryByText('UNSAVED')).not.toBeInTheDocument();
    expect(viewButton('Grouped')).not.toHaveAttribute('data-dirty');
    expect(beforeUnloadPrevented()).toBe(false);

    makeDirty();
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);
    expect(saveButton()).toHaveClass('is-dirty');
    expect(screen.getByText('UNSAVED')).toBeInTheDocument();
    expect(viewButton('Grouped')).toHaveAttribute('data-dirty', 'true');
    expect(viewButton('Grouped')).toHaveTextContent('Unsaved changes');
    expect(viewButton('Other')).not.toHaveAttribute('data-dirty');
    expect(beforeUnloadPrevented()).toBe(true);

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).not.toHaveClass('is-dirty'));
    expect(screen.queryByText('UNSAVED')).not.toBeInTheDocument();
    expect(viewButton('Grouped')).not.toHaveAttribute('data-dirty');
    expect(beforeUnloadPrevented()).toBe(false);
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);

    fireEvent.click(screen.getByRole('button', { name: 'Move BASS up' }));
    viewsClient.error = new Error('disk full');
    fireEvent.click(saveButton());
    await screen.findByRole('alert');
    expect(saveButton()).toHaveClass('is-dirty');
    expect(screen.getByText('UNSAVED')).toBeInTheDocument();
    expect(viewButton('Grouped')).toHaveAttribute('data-dirty', 'true');
  });

  it('asks before losing edits and KEEP EDITING preserves the draft', async () => {
    const { container, viewsClient } = await openSettings();
    makeDirty();

    fireEvent.click(screen.getByRole('button', { name: 'RETURN TO MIXER' }));
    expect(dialog()).toHaveAccessibleDescription(
      'Return to the mixer without saving changes to "Grouped"?',
    );
    expect(screen.getByRole('button', { name: 'KEEP EDITING' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }));
    noDialog();
    expect(window.location.pathname).toBe('/views');
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);

    fireEvent.click(viewButton('Other'));
    expect(dialog()).toHaveAccessibleDescription(
      'Switch to "Other" without saving changes to "Grouped"?',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    noDialog();
    expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Grouped');
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);

    fireEvent.click(screen.getByRole('button', { name: 'DELETE VIEW' }));
    noDialog();
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM DELETE' }));
    expect(dialog()).toHaveAccessibleDescription(
      'Delete "Grouped" and discard its unsaved changes?',
    );
    fireEvent.mouseDown(dialog().parentElement as HTMLElement);
    noDialog();
    expect(screen.getByRole('button', { name: 'DELETE VIEW' })).toBeInTheDocument();
    expect(viewsClient.calls.filter((call) => call.method === 'remove')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('NEW VIEW'), { target: { value: 'Third' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect(dialog()).toHaveAccessibleDescription(
      'Create "Third" without saving changes to "Grouped"?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }));
    noDialog();
    expect(viewsClient.calls.filter((call) => call.method === 'create')).toHaveLength(0);
    expect(screen.getByLabelText('NEW VIEW')).toHaveValue('Third');
    expect(saveButton()).toHaveClass('is-dirty');
  });

  it('DISCARD switches, creates, deletes and navigates with a clean draft', async () => {
    const { container, viewsClient } = await openSettings();
    makeDirty();

    fireEvent.click(viewButton('Other'));
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    noDialog();
    expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Other');
    expect(screen.queryByText('UNSAVED')).not.toBeInTheDocument();
    fireEvent.click(viewButton('Grouped'));
    expect(memberNames(container)).toEqual(['BASS', 'MAIN']);
    expect(screen.queryByText('UNSAVED')).not.toBeInTheDocument();

    rename('Grouped 2');
    fireEvent.change(screen.getByLabelText('NEW VIEW'), { target: { value: 'Third' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }));
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Third'),
    );
    expect(viewsClient.calls.at(-1)).toMatchObject({ method: 'create', body: { name: 'Third' } });
    expect(screen.queryByText('UNSAVED')).not.toBeInTheDocument();
    expect(screen.getByLabelText('NEW VIEW')).toHaveValue('');

    rename('Third 2');
    expect(screen.getByText('UNSAVED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DELETE VIEW' }));
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM DELETE' }));
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    await waitFor(() =>
      expect(viewsClient.calls.at(-1)).toMatchObject({ method: 'remove', id: 'view-1' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Grouped'),
    );
    expect(screen.queryByRole('button', { name: /Third/ })).not.toBeInTheDocument();

    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'RETURN TO MIXER' }));
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(viewsClient.calls.filter((call) => call.method === 'update')).toHaveLength(0);
  });

  it('holds the page on browser back and forward until the operator decides', async () => {
    const { container } = await openSettings();
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    makeDirty();

    goBack();
    expect(dialog()).toBeInTheDocument();
    expect(go).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CONTROL DESK' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }));
    noDialog();
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();

    // Forward (settings -> mixer -> back -> forward) is undone in the other direction.
    goForward();
    expect(dialog()).toBeInTheDocument();
    expect(go).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(document, { key: 'Escape' });
    noDialog();
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();

    goBack();
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('acts immediately while the draft is clean and ignores clicks on the selected view', async () => {
    const { container, viewsClient } = await openSettings();
    fireEvent.click(viewButton('Grouped'));
    noDialog();
    makeDirty();
    fireEvent.click(viewButton('Grouped'));
    noDialog();
    expect(memberNames(container)).toEqual(['MAIN', 'BASS']);
    expect(saveButton()).toHaveClass('is-dirty');
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).not.toHaveClass('is-dirty'));

    fireEvent.click(viewButton('Other'));
    noDialog();
    expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Other');

    fireEvent.change(screen.getByLabelText('NEW VIEW'), { target: { value: 'Third' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }));
    noDialog();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Third'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'DELETE VIEW' }));
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM DELETE' }));
    noDialog();
    await waitFor(() =>
      expect(viewsClient.calls.at(-1)).toMatchObject({ method: 'remove', id: 'view-1' }),
    );

    goBack();
    noDialog();
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    fireEvent.click(screen.getByRole('button', { name: 'RETURN TO MIXER' }));
    noDialog();
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
  });
});
