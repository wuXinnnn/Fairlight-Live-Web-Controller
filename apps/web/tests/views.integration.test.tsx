import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { CHANNEL_PALETTE } from '../src/features/mixer/channel-colors.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { ACTIVE_VIEW_STORAGE_KEY, resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

const snapshot: MixerSnapshot = {
  channels: [
    {
      id: 'channel/1',
      kind: 'channel',
      name: 'BASS',
      levelDb: -12,
      muted: false,
      meterDb: -30,
    },
    {
      id: 'main/1',
      kind: 'main',
      name: 'MAIN',
      levelDb: -6,
      muted: false,
      meterDb: -20,
    },
    {
      id: 'aux/1',
      kind: 'aux',
      name: 'FX',
      levelDb: -8,
      muted: true,
      meterDb: -40,
    },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

describe('views integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
  });

  it('waits for a connected mixer inventory before marking references missing', async () => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, 'startup');
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'startup',
        name: 'Startup',
        channels: [{ channelId: 'channel/1', lastKnownName: 'BASS' }],
      },
    ]);
    render(<App socket={socket} viewsClient={viewsClient} />);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Mixer view' })).toHaveValue('startup');
    });
    expect(screen.getByText('WAITING FOR MIXER SNAPSHOT')).toBeInTheDocument();
    expect(screen.queryByLabelText('BASS missing channel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    expect(screen.queryByText('1 MISSING')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CLEAR INVALID' })).not.toBeInTheDocument();

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, {
      channels: [],
      loudness: snapshot.loudness,
      connection: 'disconnected',
    });
    expect(screen.queryByText('1 MISSING')).not.toBeInTheDocument();

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, {
      channels: [],
      loudness: snapshot.loudness,
      connection: 'connected',
    });
    expect(await screen.findByText('1 MISSING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CLEAR INVALID' })).toBeInTheDocument();
  });

  it('keeps the loaded inventory through Ember reconnect without a new snapshot', async () => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, 'reconnect');
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'reconnect',
        name: 'Reconnect',
        channels: [{ channelId: 'channel/1', lastKnownName: 'BASS' }],
      },
    ]);
    render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Mixer view' })).toHaveValue('reconnect');
    });
    expect(screen.getByRole('slider', { name: 'BASS level' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'reconnecting' });
    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'BASS level' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
    expect(screen.queryByText('WAITING FOR MIXER SNAPSHOT')).not.toBeInTheDocument();

    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'BASS level' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    });
    expect(screen.queryByText('WAITING FOR MIXER SNAPSHOT')).not.toBeInTheDocument();
  });

  it('switches to ordered view channels with color overrides and missing placeholders', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'foh',
        name: 'FOH',
        channels: [
          { channelId: 'main/1', lastKnownName: 'MAIN', color: 'purple' },
          { channelId: 'channel/404', lastKnownName: 'GUEST' },
          { channelId: 'channel/1', lastKnownName: 'BASS' },
        ],
      },
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'FOH' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'foh' },
    });
    expect(screen.queryByRole('switch', { name: /new row/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('GUEST missing channel')).toHaveTextContent('MISSING');
    expect(screen.getByRole('slider', { name: 'BASS level' })).toBeInTheDocument();
    const headings = [...container.querySelectorAll('.mixer-bays > article h3')].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['MAIN', 'GUEST', 'BASS']);
    expect(
      screen
        .getByRole('heading', { name: 'MAIN', level: 3 })
        .closest<HTMLElement>('article')
        ?.style.getPropertyValue('--channel-accent'),
    ).toBe(CHANNEL_PALETTE.purple);

    socket.serverEmit(SOCKET_EVENTS.MIXER_PATCH, { removedIds: ['channel/1'] });
    await waitFor(
      () => {
        expect(screen.getByLabelText('BASS missing channel')).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
    expect(screen.getByRole('slider', { name: 'MAIN level' })).toBeInTheDocument();
  });

  it('creates, selects, reorders, colors, renames, and saves a view', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient();
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await waitFor(() => expect(viewsClient.calls[0]?.method).toBe('list'));
    await screen.findByRole('heading', { name: 'BASS' });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));

    fireEvent.change(screen.getByLabelText('NEW VIEW'), { target: { value: 'Broadcast' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect(await screen.findByDisplayValue('Broadcast')).toBeInTheDocument();
    await screen.findByRole('checkbox', { name: 'BASSINPUT' });
    const availableBass = container.querySelector<HTMLElement>(
      '[data-available-channel-id="channel/1"]',
    );
    const availableMain = container.querySelector<HTMLElement>(
      '[data-available-channel-id="main/1"]',
    );
    expect(availableBass?.style.getPropertyValue('--channel-row-accent')).toBe(
      CHANNEL_PALETTE.green,
    );
    expect(availableMain?.style.getPropertyValue('--channel-row-accent')).toBe(CHANNEL_PALETTE.red);

    fireEvent.click(screen.getByRole('checkbox', { name: 'BASSINPUT' }));
    expect(screen.getByRole('checkbox', { name: 'BASSINPUT' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'MAINMAIN' }));
    expect(screen.getByRole('checkbox', { name: 'BASSINPUT' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'MAINMAIN' })).toBeChecked();
    expect(
      container
        .querySelector<HTMLElement>('[data-ordered-channel-id="channel/1"]')
        ?.style.getPropertyValue('--channel-row-accent'),
    ).toBe(CHANNEL_PALETTE.green);
    expect(
      container
        .querySelector<HTMLElement>('[data-ordered-channel-id="main/1"]')
        ?.style.getPropertyValue('--channel-row-accent'),
    ).toBe(CHANNEL_PALETTE.red);
    fireEvent.click(screen.getByRole('button', { name: 'Move MAIN up' }));
    fireEvent.click(screen.getByRole('button', { name: 'BASS color Main Red' }));
    expect(availableBass?.style.getPropertyValue('--channel-row-accent')).toBe(
      CHANNEL_PALETTE.green,
    );
    expect(
      container
        .querySelector<HTMLElement>('[data-ordered-channel-id="channel/1"]')
        ?.style.getPropertyValue('--channel-row-accent'),
    ).toBe(CHANNEL_PALETTE.red);
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Studio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));

    await waitFor(() => {
      expect(viewsClient.calls.at(-1)).toMatchObject({
        method: 'update',
        body: {
          name: 'Studio',
          channels: [
            { channelId: 'main/1', lastKnownName: 'MAIN' },
            { channelId: 'channel/1', lastKnownName: 'BASS', color: 'red' },
          ],
        },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'RETURN TO MIXER' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'view-1' },
    });
    const headings = [...container.querySelectorAll('.mixer-bays > article h3')].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['MAIN', 'BASS']);
  });

  it('cleans only missing references and requires confirmation before deleting', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'cleanup',
        name: 'Cleanup',
        channels: [
          { channelId: 'channel/1', lastKnownName: 'BASS' },
          { channelId: 'channel/404', lastKnownName: 'GUEST', color: 'teal' },
        ],
      },
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'Cleanup' });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));

    expect(screen.getByText('1 MISSING')).toBeInTheDocument();
    expect(
      container
        .querySelector<HTMLElement>('[data-ordered-channel-id="channel/1"]')
        ?.style.getPropertyValue('--channel-row-accent'),
    ).toBe(CHANNEL_PALETTE.green);
    expect(
      container
        .querySelector<HTMLElement>('[data-ordered-channel-id="channel/404"]')
        ?.style.getPropertyValue('--channel-row-accent'),
    ).toBe(CHANNEL_PALETTE.teal);
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR INVALID' }));
    expect(viewsClient.calls.filter((call) => call.method === 'update')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM CLEAR' }));
    await waitFor(() => {
      expect(viewsClient.calls.filter((call) => call.method === 'update')).toHaveLength(1);
    });
    expect(viewsClient.calls.find((call) => call.method === 'update')?.body?.channels).toEqual([
      { channelId: 'channel/1', lastKnownName: 'BASS' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'DELETE VIEW' }));
    expect(viewsClient.calls.filter((call) => call.method === 'remove')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM DELETE' }));
    expect(
      await screen.findByRole('heading', { name: 'CREATE A VIEW TO BEGIN' }),
    ).toBeInTheDocument();
    expect(viewsClient.calls.filter((call) => call.method === 'remove')).toHaveLength(1);
  });

  it('handles empty views and configuration failures without hiding all-channel mode', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([{ id: 'empty', name: 'Empty', channels: [] }]);
    render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'Empty' });
    expect(await screen.findByRole('heading', { name: 'BASS' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'empty' },
    });
    expect(screen.getByText('THIS VIEW HAS NO CHANNELS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: ' ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    expect(screen.getByRole('alert')).toHaveTextContent('View name cannot be empty.');

    viewsClient.error = new Error('Configuration service offline');
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Recovered' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Configuration service offline');
  });
});
