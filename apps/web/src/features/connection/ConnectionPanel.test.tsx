import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConnectionClient } from '../../../tests/fake-connection-client.js';
import { resetMixerStore, setEmberStatus, setSocketConnected } from '../../store/mixer-store.js';
import { ConnectionPanel } from './ConnectionPanel.js';

function renderPanel(client: FakeConnectionClient, onClose = vi.fn()) {
  const view = render(<ConnectionPanel open client={client} onClose={onClose} />);
  return { ...view, onClose };
}

async function loaded() {
  const host = await screen.findByLabelText('HOST');
  await waitFor(() => {
    expect(host).toHaveValue('127.0.0.1');
  });
  return host as HTMLInputElement;
}

describe('ConnectionPanel', () => {
  beforeEach(() => {
    resetMixerStore();
    setSocketConnected(true);
    document.body.innerHTML = '';
  });

  it('renders nothing while closed', () => {
    render(<ConnectionPanel open={false} client={new FakeConnectionClient()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as an accessible modal, loads the endpoint, and moves focus to the host field', async () => {
    const client = new FakeConnectionClient({ host: '10.0.0.8', port: 9001 });
    renderPanel(client);
    const dialog = screen.getByRole('dialog', { name: 'CONNECTION' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(document.body).toHaveClass('is-modal-open');
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByLabelText('HOST')).toHaveValue('10.0.0.8');
    });
    expect(screen.getByLabelText('PORT')).toHaveValue('9001');
    expect(screen.getByLabelText('HOST')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeEnabled();
    expect(client.calls).toEqual([{ method: 'get' }]);
  });

  it('shows the current Ember status and last error live from the store', async () => {
    renderPanel(new FakeConnectionClient());
    await loaded();
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('DISCONNECTED');
    expect(screen.queryByTestId('connection-last-error')).not.toBeInTheDocument();

    act(() => {
      setEmberStatus('connecting', 'Timeout after 5000ms: connect');
    });
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('CONNECTING');
    expect(screen.getByTestId('connection-last-error')).toHaveTextContent(
      'Timeout after 5000ms: connect',
    );

    act(() => {
      setEmberStatus('connected');
    });
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('CONNECTED');
    expect(screen.queryByTestId('connection-last-error')).not.toBeInTheDocument();

    act(() => {
      setSocketConnected(false);
    });
    expect(screen.getByTestId('connection-ember-status')).toHaveTextContent('SOCKET OFFLINE');
  });

  it('keeps the form editable when the endpoint cannot be read', async () => {
    const client = new FakeConnectionClient();
    client.getError = new Error('Connection request failed with status 502.');
    renderPanel(client);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connection request failed with status 502.',
    );
    expect(screen.getByLabelText('HOST')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeEnabled();
  });

  it('validates the fields before sending anything', async () => {
    const client = new FakeConnectionClient();
    renderPanel(client);
    const host = await loaded();
    const port = screen.getByLabelText('PORT');

    fireEvent.change(host, { target: { value: '   ' } });
    fireEvent.change(port, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(screen.getByText('Enter a host name or IP address.')).toBeInTheDocument();
    expect(
      screen.getByText('Port must be a whole number between 1 and 65535.'),
    ).toBeInTheDocument();
    expect(host).toHaveAttribute('aria-invalid', 'true');
    expect(host).toHaveAccessibleDescription('Enter a host name or IP address.');
    expect(client.updateCalls).toEqual([]);

    fireEvent.change(host, { target: { value: '10.0.0.8' } });
    expect(screen.queryByText('Enter a host name or IP address.')).not.toBeInTheDocument();
    for (const value of ['70000', '1.5', 'abc']) {
      fireEvent.change(port, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
      expect(screen.getByText('Port must be a whole number between 1 and 65535.')).toBeVisible();
    }
    expect(client.updateCalls).toEqual([]);

    fireEvent.change(port, { target: { value: '9100' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await waitFor(() => {
      expect(client.updateCalls).toEqual([{ host: '10.0.0.8', port: 9100 }]);
    });
    expect(
      await screen.findByText('Settings applied. Watching the mixer reconnect.'),
    ).toBeVisible();
  });

  it('shows a server rejection in place and keeps the typed values', async () => {
    const client = new FakeConnectionClient();
    client.updateError = new Error('Port is out of range.');
    renderPanel(client);
    const host = await loaded();
    fireEvent.change(host, { target: { value: 'mixer.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Port is out of range.');
    expect(host).toHaveValue('mixer.local');
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeEnabled();
  });

  it('disables the form while the update is in flight', async () => {
    const client = new FakeConnectionClient();
    client.deferUpdate = true;
    const { onClose } = renderPanel(client);
    const host = await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    const applying = await screen.findByRole('button', { name: 'APPLYING' });
    expect(applying).toBeDisabled();
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    expect(host).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      client.resolveUpdate();
    });
    expect(await screen.findByRole('button', { name: 'APPLY' })).toBeEnabled();
    expect(host).toBeEnabled();
  });

  it('asks for confirmation while the mixer is connected', async () => {
    setEmberStatus('connected');
    const client = new FakeConnectionClient({ status: 'connected' });
    renderPanel(client);
    const host = await loaded();
    fireEvent.change(host, { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(client.updateCalls).toEqual([]);
    expect(
      screen.getByText(/will disconnect the current device and reconnect to/),
    ).toHaveTextContent('10.0.0.9:9000');
    const confirm = screen.getByRole('button', { name: 'CONFIRM RECONNECT' });
    expect(confirm).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'KEEP CURRENT' }));
    expect(screen.queryByRole('button', { name: 'CONFIRM RECONNECT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeInTheDocument();
    expect(client.updateCalls).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    fireEvent.change(host, { target: { value: '10.0.0.10' } });
    // Editing a field leaves the confirmation state so the text always matches the values.
    expect(screen.queryByRole('button', { name: 'CONFIRM RECONNECT' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM RECONNECT' }));
    await waitFor(() => {
      expect(client.updateCalls).toEqual([{ host: '10.0.0.10', port: 9000 }]);
    });
    expect(
      await screen.findByText('Settings applied. Watching the mixer reconnect.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'APPLY' })).toBeInTheDocument();
  });

  it('submits directly while the mixer is not connected', async () => {
    setEmberStatus('reconnecting', 'Timeout after 5000ms: connect');
    const client = new FakeConnectionClient({ status: 'reconnecting' });
    renderPanel(client);
    await loaded();
    fireEvent.submit(screen.getByRole('dialog'));
    await waitFor(() => {
      expect(client.updateCalls).toEqual([{ host: '127.0.0.1', port: 9000 }]);
    });
    expect(screen.queryByRole('button', { name: 'CONFIRM RECONNECT' })).not.toBeInTheDocument();
  });

  it('closes on Escape, the close control, CANCEL, and a backdrop press', async () => {
    const client = new FakeConnectionClient();
    const { onClose } = renderPanel(client);
    await loaded();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close connection settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    const backdrop = screen.getByRole('dialog').parentElement;
    if (backdrop === null) {
      throw new Error('missing backdrop');
    }
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(4);

    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.mouseDown(screen.getByLabelText('HOST'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('keeps Tab focus inside the dialog', async () => {
    renderPanel(new FakeConnectionClient());
    const host = await loaded();
    const closeButton = screen.getByRole('button', { name: 'Close connection settings' });
    const apply = screen.getByRole('button', { name: 'APPLY' });

    apply.focus();
    fireEvent.keyDown(apply, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(apply).toHaveFocus();

    host.focus();
    fireEvent.keyDown(host, { key: 'Tab' });
    expect(host).toHaveFocus();

    screen.getByRole('dialog').focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(apply).toHaveFocus();
  });

  it('ignores a late endpoint response after the panel closed and restores focus', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.append(opener);
    opener.focus();

    const client = new FakeConnectionClient();
    client.deferGet = true;
    const { unmount } = renderPanel(client);
    expect(screen.getByRole('dialog')).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    expect(document.body).not.toHaveClass('is-modal-open');
    await act(async () => {
      client.resolveGet();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    opener.remove();
  });
});
