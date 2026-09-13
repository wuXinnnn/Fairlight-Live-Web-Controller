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
  PAGE_PADDING_X_PX,
  SECTION_HEADER_GAP_PX,
  SECTION_HEADER_WIDTH_PX,
  STRIP_GAP_MAX_PX,
  STRIP_GAP_PX,
  STRIP_WIDTH_MAX_PX,
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

/**
 * Viewport width that fits a section header and `strips` channel strips, to the pixel. The page's
 * own side padding comes out of that width, so it has to be included here too.
 */
function widthFor(strips: number): number {
  return SECTION_HEADER_WIDTH_PX + strips * (STRIP_GAP_PX + STRIP_WIDTH_PX) + 2 * PAGE_PADDING_X_PX;
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

/** A custom property published by the deck or by one of its pages. */
function styleOf(container: HTMLElement, selector: string, property: string): string {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`styleOf: no ${selector}`);
  }
  return element.style.getPropertyValue(property);
}

function leadOf(container: HTMLElement, index: number): string {
  const page = container.querySelectorAll('.mixer-page')[index];
  if (!(page instanceof HTMLElement)) {
    throw new Error(`leadOf: no page ${index}`);
  }
  return page.style.getPropertyValue('--page-lead');
}

function currentPage(): string {
  return screen.getByLabelText('Page').textContent ?? '';
}

/** Opens the counter, types a page into it and confirms, the way a finger and a keypad do. */
function jumpTo(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
  const field = screen.getByRole('textbox', { name: 'Jump to page' });
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
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

  it('packs a page to its content box, not over it', async () => {
    const { container } = await renderDesk();

    // The page's side padding is not room for strips: one pixel under what six of them need,
    // and only five may be laid out — anything more is painted outside the clip.
    resizePager(widthFor(6));
    expect(container.querySelector('.mixer-page')?.querySelectorAll('article')).toHaveLength(6);

    resizePager(widthFor(6) - 1);
    expect(container.querySelector('.mixer-page')?.querySelectorAll('article')).toHaveLength(5);
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

  it('marks the page in view, which is the one that scrolls', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    const marked = () =>
      Array.from(container.querySelectorAll('.mixer-page')).findIndex((page) =>
        page.hasAttribute('data-current'),
      );
    expect(container.querySelectorAll('.mixer-page[data-current]')).toHaveLength(1);
    expect(marked()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(container.querySelectorAll('.mixer-page[data-current]')).toHaveLength(1);
    expect(marked()).toBe(1);
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
    // Only the two page keys and the counter that opens for a page number, and none of them
    // carries a pressed state a channel control would.
    const buttons = within(rail).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Previous page',
      'Jump to page',
      'Next page',
    ]);
    expect(buttons.filter((button) => button.hasAttribute('aria-pressed'))).toHaveLength(0);
    expect(rail.querySelector('[data-swipe-surface]')).not.toBeNull();
  });

  it('opens the counter on the page it is showing, ready to be typed over', async () => {
    await renderDesk();
    resizePager(widthFor(6));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));

    const field = screen.getByRole('textbox', { name: 'Jump to page' });
    expect(field).toHaveValue('2');
    expect(field).toHaveFocus();
    // Selected, so the page wanted is typed rather than edited into place.
    expect((field as HTMLInputElement).selectionStart).toBe(0);
    expect((field as HTMLInputElement).selectionEnd).toBe(1);
  });

  it('jumps to the page typed into the counter', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));
    const pages = pageCount(container);
    expect(pages).toBeGreaterThan(3);

    jumpTo('4');

    expect(currentPage()).toBe(`4 / ${pages}`);
  });

  it('keeps a typed page inside the deck', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));
    const pages = pageCount(container);

    jumpTo('99');

    expect(currentPage()).toBe(`${pages} / ${pages}`);
  });

  it('jumps when the field is left rather than confirmed', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    // A numeric keypad on a touch screen has no return key, so leaving the field has to commit.
    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
    const field = screen.getByRole('textbox', { name: 'Jump to page' });
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.blur(field);

    expect(currentPage()).toBe(`2 / ${pageCount(container)}`);
  });

  it('stays where it is when the jump is called off', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
    const field = screen.getByRole('textbox', { name: 'Jump to page' });
    fireEvent.change(field, { target: { value: '3' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Jump to page' })).toBeNull();
    expect(currentPage()).toBe(`1 / ${pageCount(container)}`);
  });

  it('takes nothing but a page number', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    jumpTo('2nd');
    expect(currentPage()).toBe(`2 / ${pageCount(container)}`);

    // Nothing left of it once the digits are gone, so there is no page to go to.
    jumpTo('e');
    expect(currentPage()).toBe(`2 / ${pageCount(container)}`);
  });

  it('has nothing to jump to on a desk of one page', async () => {
    await renderDesk(soloSnapshot);

    expect(screen.getByRole('button', { name: 'Jump to page' })).toBeDisabled();
  });

  it('leaves the geometry alone on a page that fills its width exactly', async () => {
    const { container } = await renderDesk();
    resizePager(widthFor(6));

    expect(styleOf(container, '.mixer-deck', '--strip-width')).toBe(`${STRIP_WIDTH_PX}px`);
    expect(styleOf(container, '.mixer-page', '--strip-gap')).toBe(`${STRIP_GAP_PX}px`);
    expect(leadOf(container, 0)).toBe('0px');
  });

  it('opens the gaps before it stretches a strip', async () => {
    const { container } = await renderDesk();
    // Twenty pixels over a page of six: less than the five gaps between them could take, so the
    // strips keep their width and the gaps swallow all of it.
    resizePager(widthFor(6) + 20);

    expect(styleOf(container, '.mixer-deck', '--strip-width')).toBe(`${STRIP_WIDTH_PX}px`);
    expect(styleOf(container, '.mixer-page', '--strip-gap')).toBe(
      `${STRIP_GAP_PX + (20 / (5 * (STRIP_GAP_MAX_PX - STRIP_GAP_PX))) * (STRIP_GAP_MAX_PX - STRIP_GAP_PX)}px`,
    );
    expect(leadOf(container, 0)).toBe('0px');
  });

  it('stretches the strips to their limit and centres the rest', async () => {
    const { container } = await renderDesk(soloSnapshot);
    const content = 1200;
    resizePager(content + 2 * PAGE_PADDING_X_PX);

    expect(styleOf(container, '.mixer-deck', '--strip-width')).toBe(`${STRIP_WIDTH_MAX_PX}px`);
    // One header and one strip, and half of what is over on either side of them.
    const used = SECTION_HEADER_WIDTH_PX + SECTION_HEADER_GAP_PX + STRIP_WIDTH_MAX_PX;
    expect(leadOf(container, 0)).toBe(`${(content - used) / 2}px`);
  });

  it('lays a short page out under the page before it', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      viewOf('grouped', 'Grouped', [
        channelGroup({ id: 'g1', name: 'Drums' }, snapshot.channels.slice(0, 3).map(refOf)),
        channelGroup({ id: 'g2', name: 'Keys' }, snapshot.channels.slice(3, 5).map(refOf)),
      ]),
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'Grouped' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'grouped' },
    });
    resizePager(2000 + 2 * PAGE_PADDING_X_PX);
    fireEvent.click(screen.getByRole('switch', { name: 'Start each group on a new page' }));
    expect(pageCount(container)).toBe(2);

    // Three strips on the first page, two on the second. The second is left-aligned where the
    // first one's strips start, so a strip does not move as the count changes.
    expect(leadOf(container, 0)).not.toBe('0px');
    expect(leadOf(container, 1)).toBe(leadOf(container, 0));
    expect(styleOf(container, '.mixer-page[data-current]', '--strip-gap')).toBe(
      `${STRIP_GAP_MAX_PX}px`,
    );
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
