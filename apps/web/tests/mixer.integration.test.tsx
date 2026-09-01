import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { CHANNEL_PALETTE } from '../src/features/mixer/channel-colors.js';
import { CONTROL_LOCK_STORAGE_KEY } from '../src/features/mixer/use-control-lock-preference.js';
import { TYPE_ROWS_STORAGE_KEY } from '../src/features/mixer/use-type-row-preference.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { FakeSocket } from './fake-socket.js';

const bassChannel = {
  id: 'channel/1',
  kind: 'channel',
  name: 'BASS',
  levelDb: -12,
  muted: false,
  meterDb: -30,
} as const;

const mainChannel = {
  id: 'main/1',
  kind: 'main',
  name: 'MAIN',
  levelDb: -6,
  muted: true,
  meterDb: -20,
} as const;

const snapshot: MixerSnapshot = {
  channels: [bassChannel, mainChannel],
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connected',
};

describe('mixer socket integration', () => {
  beforeEach(() => {
    resetMixerStore();
    resetMeterStore();
    window.localStorage.clear();
  });

  it('recovers from a disconnected empty state with a fresh snapshot', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} />);
    expect(screen.getByText('WAITING FOR MIXER SNAPSHOT')).toBeInTheDocument();

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    expect(await screen.findByRole('heading', { name: 'BASS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'INPUTS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MAIN', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AUX' })).not.toBeInTheDocument();
    expect(screen.getByText('MIXER ONLINE')).toBeInTheDocument();

    socket.disconnect();
    expect(await screen.findByText('SOCKET OFFLINE')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'BASS level' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    socket.connect();
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, {
      ...snapshot,
      channels: [{ ...bassChannel, name: 'BASS RETURN' }],
    });
    expect(await screen.findByRole('heading', { name: 'BASS RETURN' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'MAIN', level: 2 })).not.toBeInTheDocument();
    });
  });

  it('merges patches and meter frames through their independent stores', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });

    socket.serverEmit(SOCKET_EVENTS.MIXER_PATCH, {
      upserts: [
        { ...bassChannel, name: 'BASS DI' },
        {
          id: 'aux/1',
          kind: 'aux',
          name: 'FX',
          levelDb: -10,
          muted: false,
          meterDb: -60,
        },
      ],
      removedIds: ['main/1'],
    });
    expect(await screen.findByRole('heading', { name: 'BASS DI' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'AUX' })).toBeInTheDocument();

    socket.serverEmit(SOCKET_EVENTS.METERS_FRAME, {
      meters: [['channel/1', -4.5]],
      loudness: { integratedLufs: -19.2, truePeakDbtp: -1.1 },
    });
    await waitFor(() => {
      expect(screen.getByLabelText('BASS DI meter value')).toHaveTextContent('-4.5dB');
      expect(screen.getByText('-19.2')).toBeInTheDocument();
    });
  });

  it('sends level and ON commands and rolls failed ON writes back', async () => {
    const socket = new FakeSocket();
    socket.acknowledgements.set(SOCKET_EVENTS.CONTROL_SET_ON, {
      ok: false,
      error: { code: 'PROTOCOL', message: 'Write failed' },
    });
    render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });

    fireEvent.keyDown(screen.getByRole('slider', { name: 'BASS level' }), {
      key: 'ArrowUp',
    });
    await waitFor(() => {
      expect(
        socket.emitted.some(
          ({ event, args }) =>
            event === SOCKET_EVENTS.CONTROL_SET_LEVEL &&
            (args[0] as { levelDb: number }).levelDb === -11,
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'BASS on' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'BASS on' })).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Write failed');
    expect(
      socket.emitted.find(({ event }) => event === SOCKET_EVENTS.CONTROL_SET_ON)?.args[0],
    ).toEqual({
      id: 'channel/1',
      on: false,
    });
  });

  it('rejects malformed server events without corrupting the surface', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, { channels: 'invalid' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Received invalid data from the server.',
    );
    expect(screen.getByText('WAITING FOR MIXER SNAPSHOT')).toBeInTheDocument();
  });

  it('places ON above the fader and persists the optional type-row layout', async () => {
    const socket = new FakeSocket();
    const { container } = render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    const bassHeading = await screen.findByRole('heading', { name: 'BASS' });
    const strip = bassHeading.closest('article');
    const onButton = strip?.querySelector('.on-button');
    const fader = strip?.querySelector('[role="slider"]');
    expect(onButton).not.toBeNull();
    expect(fader).not.toBeNull();
    if (onButton === null || fader === null) {
      throw new Error('Channel controls were not rendered.');
    }
    expect(onButton.compareDocumentPosition(fader)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const layout = container.querySelector('.mixer-bays');
    expect(layout).not.toHaveClass('is-type-rows');
    fireEvent.click(screen.getByRole('switch', { name: 'Start each channel type on a new row' }));
    expect(layout).toHaveClass('is-type-rows');
    expect(window.localStorage.getItem(TYPE_ROWS_STORAGE_KEY)).toBe('true');
  });

  it('aligns framed readouts and applies channel type colors', async () => {
    const socket = new FakeSocket();
    const { container } = render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });

    expect(screen.getByLabelText('BASS meter value')).toHaveTextContent(/MTR\s*-30.0\s*dB/);
    expect(screen.getByLabelText('BASS level value')).toHaveTextContent(/LVL\s*-12.0\s*dB/);
    expect(
      container
        .querySelector<HTMLElement>('[data-channel-kind="channel"]')
        ?.style.getPropertyValue('--channel-accent'),
    ).toBe(CHANNEL_PALETTE.green);
    expect(
      container
        .querySelector<HTMLElement>('[data-channel-kind="main"]')
        ?.style.getPropertyValue('--channel-accent'),
    ).toBe(CHANNEL_PALETTE.red);
  });

  it('submits exact levels and rolls rejected values back', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    let input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '-12.3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(
        socket.emitted.some(
          ({ event, args }) =>
            event === SOCKET_EVENTS.CONTROL_SET_LEVEL &&
            (args[0] as { levelDb: number }).levelDb === -12.3,
        ),
      ).toBe(true);
    });

    socket.acknowledgements.set(SOCKET_EVENTS.CONTROL_SET_LEVEL, {
      ok: false,
      error: { code: 'PROTOCOL', message: 'Exact write failed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit BASS level' }));
    input = screen.getByRole('spinbutton', { name: 'BASS exact level' });
    fireEvent.change(input, { target: { value: '-5.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Exact write failed');
    expect(screen.getByLabelText('BASS level value')).toHaveTextContent('-12.3');
  });

  it('locks faders independently before locking every channel control', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });
    const slider = screen.getByRole('slider', { name: 'BASS level' });
    const levelButton = screen.getByRole('button', { name: 'Edit BASS level' });
    const onButton = screen.getByRole('button', { name: 'BASS on' });
    expect(slider).toHaveAttribute('aria-disabled', 'false');

    fireEvent.click(screen.getByRole('radio', { name: 'FADERS' }));
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(levelButton).toBeDisabled();
    expect(onButton).toBeEnabled();
    expect(window.localStorage.getItem(CONTROL_LOCK_STORAGE_KEY)).toBe('faders');

    fireEvent.click(screen.getByRole('radio', { name: 'ALL' }));
    expect(onButton).toBeDisabled();
    expect(window.localStorage.getItem(CONTROL_LOCK_STORAGE_KEY)).toBe('all');

    fireEvent.click(screen.getByRole('radio', { name: 'UNLOCKED' }));
    expect(slider).toHaveAttribute('aria-disabled', 'false');
    expect(onButton).toBeEnabled();
  });
});
