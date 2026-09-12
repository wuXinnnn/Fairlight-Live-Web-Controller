import {
  SOCKET_EVENTS,
  type ChannelKind,
  type ChannelState,
  type MixerSnapshot,
  type ViewChannelRef,
} from '@flwc/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import {
  SECTION_HEADER_WIDTH_PX,
  STRIP_GAP_PX,
  STRIP_WIDTH_PX,
} from '../src/features/mixer/page-layout.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { resizePager } from './stub-mixer-layout.js';
import { channelGroup, channelRow, viewOf } from './view-fixtures.js';

/** The view reference that points at a live channel. */
function refOf(channel: ChannelState): ViewChannelRef {
  return { kind: channel.kind, name: channel.name, channelId: channel.id };
}

/** Width that fits a section header and `strips` channel strips, to the pixel. */
function widthFor(strips: number): number {
  return SECTION_HEADER_WIDTH_PX + strips * (STRIP_GAP_PX + STRIP_WIDTH_PX);
}

const INVENTORY: Array<[ChannelKind, number, string]> = [
  ['channel', 24, 'IN'],
  ['main', 2, 'MAIN'],
  ['sub', 4, 'SUB'],
  ['aux', 6, 'AUX'],
  ['mixm', 2, 'MIXM'],
  ['mtx', 2, 'MTX'],
];

/** The 40-channel desk the pager is meant for. */
const snapshot: MixerSnapshot = {
  channels: INVENTORY.flatMap(([kind, count, prefix]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${kind}/${index + 1}`,
      kind,
      name: `${prefix}-${(index + 1).toString().padStart(2, '0')}`,
      levelDb: -12,
      muted: false,
      meterDb: -30,
    })),
  ),
  loudness: { integratedLufs: -23, truePeakDbtp: -5 },
  connection: 'connected',
};

const soloSnapshot: MixerSnapshot = { ...snapshot, channels: snapshot.channels.slice(0, 1) };

function pageCount(container: HTMLElement): number {
  return container.querySelectorAll('.mixer-page').length;
}

function currentPage(): string {
  return screen.getByLabelText('Page').textContent ?? '';
}

async function renderDesk(state: MixerSnapshot = snapshot) {
  const socket = new FakeSocket();
  const rendered = render(<App socket={socket} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, state);
  await screen.findByLabelText('Page');
  return { socket, ...rendered };
}

describe('mixer pagination', () => {
  beforeEach(() => {
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    window.localStorage.clear();
  });

  it('turns pages with the rail buttons and reports where it is', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    const pages = pageCount(container);
    expect(pages).toBeGreaterThan(1);
    expect(currentPage()).toBe(`1 / ${pages}`);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(currentPage()).toBe(`2 / ${pages}`);

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(currentPage()).toBe(`1 / ${pages}`);
  });

  it('disables the page key that would run off the end', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));
    const pages = pageCount(container);

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();

    for (let step = 1; step < pages; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    }
    expect(currentPage()).toBe(`${pages} / ${pages}`);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('still shows the counter on a single page, with both keys dead', async () => {
    await renderDesk(soloSnapshot);
    resizePager(widthFor(6));

    expect(currentPage()).toBe('1 / 1');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('turns pages with PageDown and PageUp', async () => {
    await renderDesk();
    resizePager(widthFor(6));

    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(currentPage()).toMatch(/^2 \//);
    fireEvent.keyDown(document.body, { key: 'PageUp' });
    expect(currentPage()).toMatch(/^1 \//);
  });

  it('leaves PageDown to a focused fader as its coarse step', async () => {
    await renderDesk();
    resizePager(widthFor(6));
    const fader = screen.getByRole('slider', { name: 'IN-01 level' });
    fader.focus();

    fireEvent.keyDown(fader, { key: 'PageDown' });

    expect(fader).toHaveAttribute('aria-valuenow', '-22');
    expect(currentPage()).toMatch(/^1 \//);
  });

  it('returns to the first page when the view changes', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      viewOf(
        'foh',
        'FOH',
        snapshot.channels.slice(0, 8).map((channel) => channelRow(refOf(channel))),
      ),
    ]);
    render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'FOH' });
    await screen.findByLabelText('Page');
    resizePager(widthFor(3));

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(currentPage()).toMatch(/^2 \//);

    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'foh' },
    });
    expect(currentPage()).toMatch(/^1 \//);
  });

  it('gives every channel type a page of its own once TYPE PAGES is on', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(12));
    const mixed = pageCount(container);

    fireEvent.click(screen.getByRole('switch', { name: 'Start each channel type on a new page' }));

    // Six types, each starting a page of its own; INPUTS alone needs more than one.
    expect(pageCount(container)).toBeGreaterThan(mixed);
    expect(pageCount(container)).toBeGreaterThanOrEqual(INVENTORY.length);
  });

  it('gives every group a page of its own once TYPE PAGES is on', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      viewOf('grouped', 'Grouped', [
        channelGroup({ id: 'g1', name: 'Drums' }, snapshot.channels.slice(0, 3).map(refOf)),
        channelGroup({ id: 'g2', name: 'Keys' }, snapshot.channels.slice(3, 6).map(refOf)),
      ]),
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'Grouped' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'grouped' },
    });
    resizePager(widthFor(12));
    expect(pageCount(container)).toBe(1);

    fireEvent.click(screen.getByRole('switch', { name: 'Start each group on a new page' }));

    expect(pageCount(container)).toBe(2);
  });

  it('keeps every control that could change the sound out of the rail', async () => {
    await renderDesk();
    const rail = screen.getByRole('complementary', { name: 'Pages' });

    expect(within(rail).queryByRole('slider')).toBeNull();
    expect(within(rail).queryAllByRole('switch')).toHaveLength(0);
    expect(within(rail).queryAllByRole('radio')).toHaveLength(0);
    expect(within(rail).queryByText('RESET')).toBeNull();
    // Only the two page keys, and neither carries a pressed state a channel control would.
    const buttons = within(rail).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Previous page',
      'Next page',
    ]);
    expect(buttons.filter((button) => button.hasAttribute('aria-pressed'))).toHaveLength(0);
    expect(rail.querySelector('[data-swipe-surface]')).not.toBeNull();
  });

  it('adds pages as the viewport narrows and keeps the pager inside them', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(12));
    const wide = pageCount(container);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(currentPage()).toBe(`2 / ${wide}`);

    resizePager(widthFor(3));
    const narrow = pageCount(container);
    expect(narrow).toBeGreaterThan(wide);
    expect(currentPage()).toBe(`2 / ${narrow}`);

    // Going the other way pins the pager to the last page that survives.
    resizePager(20000);
    expect(currentPage()).toBe('1 / 1');
  });
});
