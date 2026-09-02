import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

describe('routing', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
  });

  it('opens the configuration page on its own route and supports back and forward', async () => {
    const socket = new FakeSocket();
    render(<App socket={socket} viewsClient={new FakeViewsClient()} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('heading', { name: 'BASS' });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    vi.mocked(window.scrollTo).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    expect(window.location.pathname).toBe('/views');
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CONTROL DESK' })).not.toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'VIEW CONFIGURATION' })).not.toBeInTheDocument();

    act(() => {
      window.history.pushState(null, '', '/views');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
  });

  it('renders the configuration page directly from /views and returns to the mixer', async () => {
    window.history.replaceState(null, '', '/views');
    const socket = new FakeSocket();
    render(<App socket={socket} viewsClient={new FakeViewsClient()} />);
    expect(screen.getByRole('heading', { name: 'VIEW CONFIGURATION' })).toBeInTheDocument();
    expect(screen.getByText('FAIRLIGHT LIVE / CONTROL DESK')).toBeInTheDocument();

    const back = screen.getByRole('button', { name: 'RETURN TO MIXER' });
    expect(back).toHaveClass('console-back');
    expect(back.querySelector('svg')).not.toBeNull();
    fireEvent.click(back);
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
  });
});
