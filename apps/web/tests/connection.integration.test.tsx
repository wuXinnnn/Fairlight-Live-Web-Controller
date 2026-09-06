import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeConnectionClient } from './fake-connection-client.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

function renderApp(client = new FakeConnectionClient()) {
  const socket = new FakeSocket();
  render(<App socket={socket} viewsClient={new FakeViewsClient()} connectionClient={client} />);
  return { socket, client };
}

async function openPanel() {
  const lamp = screen.getByRole('button', { name: 'Connection settings' });
  lamp.focus();
  fireEvent.click(lamp);
  const dialog = await screen.findByRole('dialog', { name: 'CONNECTION' });
  await waitFor(() => {
    expect(screen.getByLabelText('HOST')).toHaveValue('127.0.0.1');
  });
  return { lamp, dialog };
}

describe('connection panel integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
  });

  it('opens from the mixer status lamp and returns focus to it when closed', async () => {
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('EMBER DISCONNECTED');
    const { lamp } = await openPanel();
    expect(screen.getByLabelText('PORT')).toHaveValue('9000');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(lamp).toHaveFocus();

    fireEvent.click(lamp);
    await screen.findByRole('dialog', { name: 'CONNECTION' });
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(lamp).toHaveFocus();
  });

  it('opens from the configuration page lamp as well', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    expect(await screen.findByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
    const { lamp } = await openPanel();
    expect(screen.getByRole('heading', { name: 'CONNECTION' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(lamp).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
  });

  it('confirms before reconnecting a connected mixer and reflects the status live', async () => {
    const { socket, client } = renderApp(new FakeConnectionClient({ status: 'connected' }));
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    expect(await screen.findByText('MIXER ONLINE')).toBeInTheDocument();
    await openPanel();
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('CONNECTED');

    fireEvent.change(screen.getByLabelText('PORT'), { target: { value: '9100' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(client.updateCalls).toEqual([]);
    expect(screen.getByText(/will disconnect the current device/)).toHaveTextContent(
      '127.0.0.1:9100',
    );

    fireEvent.click(screen.getByRole('button', { name: 'KEEP CURRENT' }));
    expect(client.updateCalls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM RECONNECT' }));
    await waitFor(() => {
      expect(client.updateCalls).toEqual([{ host: '127.0.0.1', port: 9100 }]);
    });
    expect(
      await screen.findByText('Settings applied. Watching the mixer reconnect.'),
    ).toBeVisible();

    act(() => {
      socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'reconnecting' });
    });
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('RECONNECTING');
    act(() => {
      socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, {
        ember: 'reconnecting',
        lastError: 'Timeout after 5000ms: connect',
      });
    });
    expect(screen.getByTestId('connection-last-error')).toHaveTextContent(
      'Timeout after 5000ms: connect',
    );
    act(() => {
      socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    });
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('CONNECTED');
    expect(screen.queryByTestId('connection-last-error')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('submits without confirmation while the mixer is not connected', async () => {
    const { socket, client } = renderApp();
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, {
      ember: 'connecting',
      lastError: 'Timeout after 5000ms: connect',
    });
    await openPanel();
    expect(screen.getByTestId('connection-last-error')).toHaveTextContent(
      'Timeout after 5000ms: connect',
    );
    fireEvent.change(screen.getByLabelText('HOST'), { target: { value: '10.0.0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await waitFor(() => {
      expect(client.updateCalls).toEqual([{ host: '10.0.0.8', port: 9000 }]);
    });
    expect(screen.queryByRole('button', { name: 'CONFIRM RECONNECT' })).not.toBeInTheDocument();
  });
});
