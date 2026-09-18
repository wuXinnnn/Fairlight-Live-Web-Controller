import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { FakeLauncherApi, snapshot } from '../tests/fake-launcher-api.js';

/** Renders and waits for the first `launcher_state` to have landed. */
async function mount(api: FakeLauncherApi) {
  render(<App api={api} />);
  await screen.findByText(/STOPPED|STARTING|RUNNING|FAILED/);
  return api;
}

function setPort(value: string) {
  fireEvent.change(screen.getByLabelText('Port'), { target: { value } });
}

describe('the status line', () => {
  it('shows the state and the address a tablet can reach', async () => {
    await mount(new FakeLauncherApi());
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('http://192.168.1.40:3000')).toBeInTheDocument();
  });

  it('falls back to localhost when access from the network is off', async () => {
    await mount(
      new FakeLauncherApi(
        snapshot({
          settings: { version: 1, port: 3100, bindLan: false, startHidden: false },
          localUrl: 'http://localhost:3100',
          lanUrl: null,
        }),
      ),
    );
    expect(screen.getByText('http://localhost:3100')).toBeInTheDocument();
  });

  it('follows the server-state event', async () => {
    const api = await mount(new FakeLauncherApi());
    act(() => api.emitState({ kind: 'starting' }));
    expect(screen.getByText('STARTING')).toBeInTheDocument();
  });

  it('copies the address it is showing', async () => {
    const api = await mount(new FakeLauncherApi());
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(api.copied).toEqual(['http://192.168.1.40:3000']);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('a failure', () => {
  it('explains itself and shows the last output', async () => {
    await mount(
      new FakeLauncherApi(
        snapshot({
          server: {
            kind: 'failed',
            reason: 'exitedBeforeReady',
            exitCode: 1,
            tail: ['listen EADDRINUSE'],
          },
        }),
      ),
    );
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(
      screen.getByText('The backend exited before it was ready (exit code 1).'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Last output before the failure')).toHaveTextContent(
      'listen EADDRINUSE',
    );
  });
});

describe('the port field', () => {
  it('offers Apply only for a valid change', async () => {
    const api = await mount(new FakeLauncherApi());
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    setPort('');
    expect(apply).toBeDisabled();

    setPort('99999');
    expect(apply).toBeDisabled();

    setPort('3100');
    expect(apply).toBeEnabled();
    expect(api.applied).toEqual([]);
  });

  it('applies the new port and waits for the restart to settle', async () => {
    const api = await mount(new FakeLauncherApi());
    setPort('3100');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(api.applied).toEqual([{ version: 1, port: 3100, bindLan: true, startHidden: false }]);
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled();

    act(() => api.emitState({ kind: 'running', port: 3100 }));
    expect(await screen.findByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('stops saying Restarting when the call is rejected', async () => {
    const api = new FakeLauncherApi();
    api.applyError = new Error('port 3100 is not usable');
    await mount(api);
    setPort('3100');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});

describe('the network checkbox', () => {
  it('is a change Apply can act on', async () => {
    const api = await mount(new FakeLauncherApi());
    fireEvent.click(screen.getByLabelText('Allow access from other devices on the network'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(api.applied).toEqual([{ version: 1, port: 3000, bindLan: false, startHidden: false }]);
  });
});

describe('the startup group', () => {
  it('registers and unregisters the startup entry', async () => {
    const api = await mount(new FakeLauncherApi());
    const toggle = screen.getByLabelText('Start with Windows');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(api.autostartCalls).toEqual([true]);
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);
    expect(api.autostartCalls).toEqual([true, false]);
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('shows what the startup entry actually ended up as', async () => {
    const api = new FakeLauncherApi();
    // The registration was refused, so the box has to go back to unticked.
    api.autostartResult = false;
    await mount(api);
    const toggle = screen.getByLabelText('Start with Windows');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('saves Start hidden without a restart', async () => {
    const api = await mount(new FakeLauncherApi());
    fireEvent.click(screen.getByLabelText('Start hidden in the tray'));
    expect(api.applied).toEqual([{ version: 1, port: 3000, bindLan: true, startHidden: true }]);
    // Nothing the backend cares about changed, so the button never says Restarting.
    expect(screen.queryByRole('button', { name: 'Restarting…' })).not.toBeInTheDocument();
  });
});

describe('the action buttons', () => {
  it('each call their own command', async () => {
    const api = await mount(new FakeLauncherApi());
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide to tray' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect([api.opened, api.hidden, api.quits]).toEqual([1, 1, 1]);
  });
});

describe('the log pane', () => {
  it('starts with the tail the Rust side already had', async () => {
    await mount(new FakeLauncherApi(snapshot({ log: ['first', 'second'] })));
    expect(screen.getByLabelText('Server log')).toHaveValue('first\nsecond');
  });

  it('appends lines as they arrive and scrolls to the bottom', async () => {
    const api = await mount(new FakeLauncherApi());
    act(() => api.emitLog('Server listening'));
    act(() => api.emitLog('a warning', 'stderr'));

    const pane = screen.getByLabelText('Server log');
    expect(pane).toHaveValue('Server listening\na warning');
    // jsdom reports zero for both, so this asserts the write happened, not the geometry.
    expect((pane as HTMLTextAreaElement).scrollTop).toBe(
      (pane as HTMLTextAreaElement).scrollHeight,
    );
  });
});

describe('a settings file that could not be used', () => {
  it('says so above everything else', async () => {
    await mount(
      new FakeLauncherApi(
        snapshot({ notice: 'launcher.json was not usable, using defaults: expected value' }),
      ),
    );
    expect(screen.getByText(/launcher.json was not usable/)).toBeInTheDocument();
  });
});

describe('unmounting', () => {
  it('lets go of both event subscriptions', async () => {
    const api = new FakeLauncherApi();
    const { unmount } = render(<App api={api} />);
    await screen.findByText('RUNNING');
    unmount();
    await waitFor(() => expect(api.unlistened).toBe(2));
  });
});
