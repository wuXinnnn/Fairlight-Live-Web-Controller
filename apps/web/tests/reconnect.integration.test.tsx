import { SOCKET_EVENTS, type MixerSnapshot } from '@flwc/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { ACK_TIMEOUT_MS } from '../src/lib/socket.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { mixerStore, resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { channelRow as row, viewOf } from './view-fixtures.js';

/**
 * Four strips of one kind, which is exactly two pages.
 *
 * The stubbed viewport is 299 px wide with 24 px of padding either side, leaving 251 px of content
 * — two 125 px strips and the 1 px gap between them, to the pixel. A strip of a second kind would
 * have to pay the 14 px segment gap instead and would not fit beside the first, so keeping every
 * channel the same kind is what makes the page count predictable. The first assertion of every
 * case checks the count, so a change to those measurements is caught here rather than three
 * assertions later.
 */
const CHANNELS = ['IN-01', 'IN-02', 'IN-03', 'IN-04'].map((name, index) => ({
  id: `channel/${index + 1}`,
  kind: 'channel' as const,
  name,
  levelDb: -12,
  muted: false,
  meterDb: -30,
}));

const snapshot: MixerSnapshot = {
  channels: CHANNELS,
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connected',
};

/** The shape the server hands out between accepting connections and finishing its Ember dial. */
const restartingSnapshot: MixerSnapshot = {
  channels: [],
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connecting',
};

/** A socket that leaves chosen commands unanswered, the way a desk that has gone away does. */
class SilentAckSocket extends FakeSocket {
  readonly silent = new Set<string>();

  override emit(event: string, ...args: unknown[]): void {
    if (this.silent.has(event)) {
      this.emitted.push({ event, args });
      return;
    }
    super.emit(event, ...args);
  }
}

function stripOf(name: string): HTMLElement {
  const strip = screen.getByRole('heading', { name }).closest('article');
  if (strip === null) {
    throw new Error(`no strip rendered for ${name}`);
  }
  return strip;
}

function meterOf(name: string): Element {
  const meter = stripOf(name).querySelector('.meter');
  if (meter === null) {
    throw new Error(`no meter rendered for ${name}`);
  }
  return meter;
}

function wakeLockState(): string | null {
  return document.querySelector('.mixer-shell')?.getAttribute('data-wake-lock') ?? null;
}

function pageLabel(): HTMLElement {
  return screen.getByLabelText('Page');
}

async function renderLoaded(socket: FakeSocket, viewsClient?: FakeViewsClient): Promise<void> {
  render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  await screen.findByRole('heading', { name: 'IN-01' });
  expect(pageLabel()).toHaveTextContent('1 / 2');
}

describe('mixer reconnect integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
  });

  it('keeps the view, the page and the lock through a socket reconnect', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      viewOf(
        'live',
        'LIVE',
        CHANNELS.map((channel) =>
          row({ kind: 'channel', name: channel.name, channelId: channel.id }),
        ),
      ),
    ]);
    await renderLoaded(socket, viewsClient);

    await screen.findByRole('option', { name: 'LIVE' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'live' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pageLabel()).toHaveTextContent('2 / 2');
    fireEvent.click(screen.getByRole('radio', { name: 'FADERS' }));
    const strip = stripOf('IN-01');

    socket.disconnect();
    expect(await screen.findByText('SOCKET OFFLINE')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'IN-01 level' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(meterOf('IN-01')).toHaveClass('is-frozen');
    await waitFor(() => expect(wakeLockState()).toBe('idle'));

    socket.connect();
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    expect(await screen.findByText('MIXER ONLINE')).toBeInTheDocument();

    expect(screen.getByRole('combobox', { name: 'Mixer view' })).toHaveValue('live');
    expect(pageLabel()).toHaveTextContent('2 / 2');
    expect(screen.getByRole('radio', { name: 'FADERS' })).toHaveAttribute('aria-checked', 'true');
    // Still locked rather than still offline: the fader stays disabled while ON comes back.
    expect(screen.getByRole('slider', { name: 'IN-01 level' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'IN-01 on' })).toBeEnabled();
    expect(meterOf('IN-01')).not.toHaveClass('is-frozen');

    socket.serverEmit(SOCKET_EVENTS.METERS_FRAME, { meters: [['channel/1', -8.5]] });
    await waitFor(() => {
      expect(screen.getByLabelText('IN-01 meter value')).toHaveTextContent('-8.5');
    });
    await waitFor(() => expect(wakeLockState()).toBe('active'));
    // The same element throughout: the strip was never unmounted and remounted around the outage.
    expect(stripOf('IN-01')).toBe(strip);
  });

  it('does not send the fader it was holding when the socket drops mid-drag', async () => {
    const socket = new FakeSocket();
    await renderLoaded(socket);

    const slider = screen.getByRole('slider', { name: 'IN-01 level' });
    const cap = slider.querySelector('.fader__cap');
    expect(cap).not.toBeNull();
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 40,
      bottom: 100,
      width: 40,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(cap as Element, { pointerId: 1, clientY: 50 });
    // Under the drag threshold, so the fader has not taken the gesture yet.
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 51 });
    expect(mixerStore.getState().pendingLevels['channel/1']).toBeUndefined();
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 30 });
    expect(mixerStore.getState().pendingLevels['channel/1']?.baseline).toBe(-12);

    // Anything sent up to here went out over a live socket and is none of this case's business.
    const sentWhileOnline = socket.emitted.filter(
      (entry) => entry.event === SOCKET_EVENTS.CONTROL_SET_LEVEL,
    ).length;

    socket.disconnect();
    expect(await screen.findByText('SOCKET OFFLINE')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-disabled', 'true');

    const frozen = screen.getByLabelText('IN-01 level value').textContent;
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 5 });
    expect(screen.getByLabelText('IN-01 level value')).toHaveTextContent(frozen ?? '');

    // Letting go still commits: the pointer handler bails while disabled but `finishPointer` does
    // not, so this is the send that used to sit in the buffer waiting for the socket to return.
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 5 });

    expect(await screen.findByRole('alert')).toHaveTextContent('The mixer is offline.');
    expect(
      socket.emitted.filter((entry) => entry.event === SOCKET_EVENTS.CONTROL_SET_LEVEL),
    ).toHaveLength(sentWhileOnline);
    expect(mixerStore.getState().pendingLevels).toEqual({});
    expect(mixerStore.getState().channels['channel/1']?.levelDb).toBe(-12);

    socket.connect();
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'));
    expect(screen.getByLabelText('IN-01 level value')).toHaveTextContent('-12.0');
  });

  it('keeps the strips mounted while Ember reconnects underneath them', async () => {
    const socket = new FakeSocket();
    await renderLoaded(socket);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pageLabel()).toHaveTextContent('2 / 2');
    const strip = stripOf('IN-01');

    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, {
      ember: 'reconnecting',
      lastError: 'Timeout after 5000ms: connect',
    });
    expect(await screen.findByText('EMBER RECONNECTING')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'IN-01 level' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'IN-01 on' })).toBeDisabled();
    expect(meterOf('IN-01')).toHaveClass('is-frozen');
    await waitFor(() => expect(wakeLockState()).toBe('idle'));
    expect(stripOf('IN-01')).toBe(strip);

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    expect(await screen.findByText('MIXER ONLINE')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'IN-01 level' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(meterOf('IN-01')).not.toHaveClass('is-frozen');
    expect(pageLabel()).toHaveTextContent('2 / 2');
    expect(stripOf('IN-01')).toBe(strip);
  });

  it('holds the desk on screen when the socket returns before Ember does', async () => {
    const socket = new FakeSocket();
    await renderLoaded(socket);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const strip = stripOf('IN-01');

    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'reconnecting' });
    socket.disconnect();
    expect(await screen.findByText('SOCKET OFFLINE')).toBeInTheDocument();

    socket.connect();
    // A server that has accepted the connection but not finished its Ember dial hands out an
    // empty snapshot. The cached inventory has to survive it, or the desk blinks empty for as
    // long as the dial takes.
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, restartingSnapshot);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connecting' });

    expect(await screen.findByText('EMBER CONNECTING')).toBeInTheDocument();
    expect(screen.queryByText('MIXER NOT CONNECTED')).toBeNull();
    expect(stripOf('IN-01')).toBe(strip);
    expect(pageLabel()).toHaveTextContent('2 / 2');

    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    expect(await screen.findByText('MIXER ONLINE')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'IN-01 level' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(pageLabel()).toHaveTextContent('2 / 2');
    expect(stripOf('IN-01')).toBe(strip);
  });

  it('never flashes an empty desk when Ember returns before the socket does', async () => {
    const socket = new FakeSocket();
    await renderLoaded(socket);
    const strip = stripOf('IN-01');

    socket.disconnect();
    expect(await screen.findByText('SOCKET OFFLINE')).toBeInTheDocument();

    socket.connect();
    // `connect` is dispatched synchronously and React has not rendered yet, so the absence below
    // would only be the absence of a render without this flush.
    await act(async () => {});
    expect(screen.queryByText('MIXER NOT CONNECTED')).toBeNull();
    expect(screen.queryByText('BACKEND OFFLINE')).toBeNull();
    expect(stripOf('IN-01')).toBe(strip);

    // Ember came back while nobody was connected, so the first snapshot is already a connected one.
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    socket.serverEmit(SOCKET_EVENTS.SYSTEM_STATUS, { ember: 'connected' });
    expect(await screen.findByText('MIXER ONLINE')).toBeInTheDocument();
    expect(screen.queryByText('MIXER NOT CONNECTED')).toBeNull();
    expect(screen.queryByText('BACKEND OFFLINE')).toBeNull();
    expect(stripOf('IN-01')).toBe(strip);
  });

  it('lets a reconnect snapshot outlive an acknowledgement that times out after it', async () => {
    const socket = new SilentAckSocket();
    await renderLoaded(socket);

    vi.useFakeTimers();
    try {
      socket.silent.add(SOCKET_EVENTS.CONTROL_SET_ON);
      fireEvent.click(screen.getByRole('button', { name: 'IN-01 on' }));
      expect(mixerStore.getState().pendingOns['channel/1']).toBeDefined();

      socket.disconnect();
      socket.connect();
      socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
      // The snapshot is the authority on what the desk holds, and it clears the pending write.
      expect(mixerStore.getState().pendingOns).toEqual({});

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      });

      // The late timeout lands on a write that is no longer pending, so it changes nothing: the
      // snapshot stands, and no stale rollback is announced to the operator.
      expect(mixerStore.getState().channels['channel/1']?.muted).toBe(false);
      expect(mixerStore.getState().notice).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
