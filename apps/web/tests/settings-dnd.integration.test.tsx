import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { pickUp, press } from './keyboard-drag.js';
import { pointerDown, pointerMoveTo, pointerUp } from './pointer-drag.js';
import { advanceTouchDelay, touchEnd, touchMove, touchStart } from './touch-drag.js';
import { STUB_LIST_PADDING, STUB_ROW_HEIGHT, stubListLayout } from './stub-layout.js';
import {
  TOUCH_ACTIVATION_DELAY_MS,
  TOUCH_ACTIVATION_TOLERANCE_PX,
  VIEW_MEASURING,
} from '../src/features/settings/dnd-config.js';
import { recordFlipWrites } from './flip-writes.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
    { id: 'aux/1', kind: 'aux', name: 'FX', levelDb: -8, muted: true, meterDb: -40 },
    { id: 'sub/1', kind: 'sub', name: 'SUB', levelDb: -10, muted: false, meterDb: -35 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const BASS = { kind: 'channel', name: 'BASS', channelId: 'channel/1' } as const;
const MAIN = { kind: 'main', name: 'MAIN', channelId: 'main/1' } as const;
const FX = { kind: 'aux', name: 'FX', channelId: 'aux/1' } as const;
const SUB = { kind: 'sub', name: 'SUB', channelId: 'sub/1' } as const;
const RHYTHM = { id: 'g1', name: 'Rhythm' };

async function openSettings(view: View) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient([view]);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  await screen.findByRole('option', { name: view.name });
  fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
  const list = () => container.querySelector('.view-channel-list') as HTMLElement;
  const orderedNames = () =>
    [...container.querySelectorAll('.view-channel-list .channel-order-row')].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const memberNames = (groupId: string) =>
    [...container.querySelectorAll(`[data-view-group-id="${groupId}"] .channel-order-row`)].map(
      (row) => (row as HTMLElement).dataset.orderedChannelName,
    );
  const handle = (name: string) => within(list()).getByRole('button', { name: `Drag ${name}` });
  const availableHandle = (channelId: string) =>
    within(
      container.querySelector(`[data-available-channel-id="${channelId}"]`) as HTMLElement,
    ).getByRole('button', { name: /^Drag / });
  const savedChannels = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    await waitFor(() => expect(viewsClient.calls.at(-1)?.method).toBe('update'));
    return viewsClient.calls.at(-1)?.body?.channels;
  };
  return {
    container,
    viewsClient,
    list,
    orderedNames,
    memberNames,
    handle,
    availableHandle,
    savedChannels,
  };
}

describe('settings drag and drop (keyboard sensor)', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
  });

  afterEach(() => {
    restoreLayout();
  });

  it('tweens the rows a drag preview displaces and skips a view switch', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    const flip = recordFlipWrites(page.list());
    const bassKey = 'channel:BASS:channel/1#0';
    const mainKey = 'main:MAIN:main/1#0';

    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    // The draft has not changed, only the preview; MAIN still moved up and must tween there.
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']);
    expect(flip.tweened()).toContain(mainKey);
    expect(flip.writes()).toContainEqual({
      key: mainKey,
      transform: `translate(0px, ${STUB_ROW_HEIGHT}px)`,
    });
    // The dragged row follows the pointer instead of trailing it, so it is never tweened.
    expect(flip.tweened()).not.toContain(bassKey);

    // Escape drops the preview, which moves MAIN back and tweens it again.
    await press('Escape');
    await waitFor(() => expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']));
    expect(flip.writes()).toContainEqual({
      key: mainKey,
      transform: `translate(0px, -${STUB_ROW_HEIGHT}px)`,
    });
    flip.stop();
  });

  it('tweens each row it crosses exactly once when arrows outrun the animation', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX, SUB],
      groups: [],
    });
    const flip = recordFlipWrites(page.list());

    // Three steps in a row, none of them waiting for the previous tween to be cleaned up.
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    await press('ArrowDown');
    await press('ArrowDown');
    expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'SUB', 'BASS']);

    // Each row BASS passed moved up exactly one row, and was told so exactly once. Measuring
    // natural positions is what keeps a tween that is still running from being replayed.
    const moved = flip.writes().filter((write) => write.transform !== '');
    for (const key of ['main:MAIN:main/1#0', 'aux:FX:aux/1#0', 'sub:SUB:sub/1#0']) {
      const forRow = moved.filter((write) => write.key === key);
      expect(forRow).toEqual([{ key, transform: `translate(0px, ${STUB_ROW_HEIGHT}px)` }]);
    }
    // Nothing was ever asked to jump further than the one row it actually moved.
    for (const write of moved) {
      const distance = Math.abs(Number(/-?[\d.]+/.exec(write.transform)?.[0] ?? 0));
      expect(distance).toBeLessThanOrEqual(STUB_ROW_HEIGHT);
    }
    flip.stop();
  });

  it('measures droppables where they belong, not where a tween is holding them', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    const row = page.list().querySelector('[data-flip-key="main:MAIN:main/1#0"]') as HTMLElement;
    const settled = VIEW_MEASURING.droppable?.measure?.(row);

    // Hold the row a row-height away, as a tween part way through its 120ms would.
    row.style.transform = `translate(0px, ${STUB_ROW_HEIGHT}px)`;
    expect(row.getBoundingClientRect().top).toBe((settled?.top ?? 0) + STUB_ROW_HEIGHT);
    expect(VIEW_MEASURING.droppable?.measure?.(row)).toEqual(settled);
  });

  it('does not tween rows that two views happen to share', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      { id: 'a', name: 'Alpha', channels: [BASS, MAIN], groups: [] },
      { id: 'b', name: 'Beta', channels: [MAIN, BASS], groups: [] },
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    await screen.findByRole('option', { name: 'Alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIGURE VIEWS' }));
    const orderedNames = () =>
      [...container.querySelectorAll('.view-channel-list .channel-order-row')].map(
        (element) => (element as HTMLElement).dataset.orderedChannelName,
      );
    await waitFor(() => expect(orderedNames()).toEqual(['BASS', 'MAIN']));

    const flip = recordFlipWrites(container.querySelector('.view-channel-list') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await waitFor(() => expect(orderedNames()).toEqual(['MAIN', 'BASS']));
    expect(flip.tweened()).toEqual([]);
    flip.stop();
  });

  it('takes the first channel of an empty view from AVAILABLE', async () => {
    const page = await openSettings({ id: 'new', name: 'New', channels: [], groups: [] });
    expect(screen.getByText('THIS VIEW HAS NO CHANNELS')).toBeInTheDocument();
    expect(page.list()).not.toBeNull();

    // The slot that fills the empty list is the only target, so the pickup already previews there.
    await pickUp(page.availableHandle('channel/1'));
    expect(page.orderedNames()).toEqual(['BASS']);
    expect(screen.queryByText('THIS VIEW HAS NO CHANNELS')).toBeNull();
    await press('Space');

    await waitFor(() => expect(page.orderedNames()).toEqual(['BASS']));
    expect(screen.getByRole('checkbox', { name: /BASS/ })).toBeChecked();
    expect(await page.savedChannels()).toEqual([BASS]);
  });

  it('moves a channel between an empty group and the empty list around it', async () => {
    const page = await openSettings({
      id: 'groups',
      name: 'Groups',
      channels: [],
      groups: [RHYTHM],
    });
    expect(page.orderedNames()).toEqual([]);

    // The empty group block sits above the fill slot, so the pickup previews into the group.
    await pickUp(page.availableHandle('channel/1'));
    expect(page.memberNames('g1')).toEqual(['BASS']);
    // Down from there is the slot filling the rest of the list: the channel leaves the group.
    await press('ArrowDown');
    expect(page.memberNames('g1')).toEqual([]);
    expect(page.orderedNames()).toEqual(['BASS']);
    // And back up into the group again.
    await press('ArrowUp');
    expect(page.memberNames('g1')).toEqual(['BASS']);

    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['BASS']));
    expect(await page.savedChannels()).toEqual([{ ...BASS, groupId: 'g1', color: 'group' }]);
  });

  it('reorders ungrouped rows and saves the new order', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    await pickUp(page.handle('BASS'));
    // An idle mouse resting on the upper half of MAIN must not turn the arrow into "before".
    fireEvent.pointerMove(window, {
      clientX: 700,
      clientY: STUB_LIST_PADDING + STUB_ROW_HEIGHT * 1.1,
    });
    await press('ArrowDown');
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']);
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']));
    expect(await page.savedChannels()).toEqual([MAIN, BASS, FX]);

    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']));
  });

  it('moves an ungrouped row into a group and a member back out', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    // The placeholder already sits inside the group before the drop.
    expect(page.container.querySelector('[data-view-group-id="g1"]')).toHaveClass('is-drop-target');
    expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN', 'FX']);
    expect(
      page.container.querySelector('[data-view-group-id="g1"] [data-ordered-channel-name="BASS"]'),
    ).toHaveClass('is-dragging');
    expect(document.querySelector('.drag-overlay')).toHaveTextContent('BASS');
    // Dropping keeps the overlay clone mounted for its drop animation until the animation
    // settles (synchronously here, jsdom has no computed transform), so it must still carry
    // the row's label after the drag state is gone.
    fireEvent.keyDown(document, { code: 'Space', key: ' ' });
    expect(document.querySelector('.drag-overlay')).toHaveTextContent('BASS');
    await waitFor(() => expect(document.querySelector('.drag-overlay')).toBeNull());
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'BASS', 'FX']));
    expect(screen.getByRole('combobox', { name: 'BASS group' })).toHaveValue('g1');
    expect(page.container.querySelector('[data-view-group-id="g1"]')).not.toHaveClass(
      'is-drop-target',
    );
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...BASS, groupId: 'g1', color: 'group' },
      { ...FX, groupId: 'g1' },
    ]);

    // With no ungrouped row left, the group starts the list, so a root slot above it lets a
    // member leave the group to the top: two steps reorder inside the group (the list already
    // shows the previewed order), the third reaches the slot.
    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    expect(page.memberNames('g1')).toEqual(['MAIN', 'FX', 'BASS']);
    await press('ArrowUp');
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN', 'BASS']);
    expect(page.container.querySelector('[data-root-slot="0"]')).toBeInTheDocument();
    await press('ArrowUp');
    // The placeholder now sits above the group; the slot stays drawn right below it, so
    // hovering on is a no-op rather than a jump back into the group.
    expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']);
    expect(page.memberNames('g1')).toEqual(['MAIN', 'BASS']);
    const items = [...page.list().children];
    expect(items[0]).toHaveAttribute('data-ordered-channel-name', 'FX');
    expect(items[1]).toHaveClass('root-slot');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']));
    expect(page.memberNames('g1')).toEqual(['MAIN', 'BASS']);
    expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue('');
    expect(page.container.querySelector('.root-slot')).not.toBeInTheDocument();
  });

  it('drops channels between two groups and before the first one through root slots', async () => {
    const VOCALS = { id: 'g2', name: 'Vocals' };
    const page = await openSettings({
      id: 'stacked',
      name: 'Stacked',
      channels: [
        { ...MAIN, groupId: 'g1' },
        { ...FX, groupId: 'g1' },
        { ...BASS, groupId: 'g2' },
      ],
      groups: [RHYTHM, VOCALS],
    });
    expect(page.container.querySelector('.root-slot')).not.toBeInTheDocument();

    // FX steps down onto the slot between Rhythm and Vocals and leaves its group there.
    await pickUp(page.handle('FX'));
    expect(
      [...page.container.querySelectorAll('[data-root-slot]')].map((slot) =>
        slot.getAttribute('data-root-slot'),
      ),
    ).toEqual(['0', '1', '2']);
    await press('ArrowDown');
    expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'BASS']);
    expect(page.memberNames('g1')).toEqual(['MAIN']);
    expect(page.memberNames('g2')).toEqual(['BASS']);
    await press('Space');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue(''));
    expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'BASS']);
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      FX,
      { ...BASS, groupId: 'g2' },
    ]);

    // Up once joins Rhythm above MAIN, up again reaches the slot above the first group.
    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN']);
    await press('ArrowUp');
    expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']);
    expect(page.memberNames('g1')).toEqual(['MAIN']);
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']));
    expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue('');
    expect(await page.savedChannels()).toEqual([
      FX,
      { ...MAIN, groupId: 'g1' },
      { ...BASS, groupId: 'g2' },
    ]);

    // An AVAILABLE channel lands on slots too: picked up level with the boundary between the
    // groups, the nearest target is the slot band, so the placeholder appears between them.
    await pickUp(page.availableHandle('sub/1'));
    expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'SUB', 'BASS']);
    expect(page.memberNames('g1')).toEqual(['MAIN']);
    expect(page.memberNames('g2')).toEqual(['BASS']);
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'SUB', 'BASS']));
    expect(screen.getByRole('combobox', { name: 'SUB group' })).toHaveValue('');
    expect(await page.savedChannels()).toEqual([
      FX,
      { ...MAIN, groupId: 'g1' },
      SUB,
      { ...BASS, groupId: 'g2' },
    ]);
  });

  it('moves a member above the group so it leaves the group', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('MAIN'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']));
    expect(page.memberNames('g1')).toEqual(['FX']);
    expect(screen.getByRole('combobox', { name: 'MAIN group' })).toHaveValue('');
    expect(await page.savedChannels()).toEqual([MAIN, BASS, { ...FX, groupId: 'g1' }]);
  });

  it('moves a whole group with its drag handle', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    await pickUp(page.handle('group Rhythm'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'BASS']));
    expect(screen.getByRole('button', { name: 'Move group Rhythm up' })).toBeDisabled();
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...FX, groupId: 'g1' },
      BASS,
    ]);
  });

  it('drops a row onto an empty group', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN],
      groups: [],
    });
    fireEvent.change(screen.getByLabelText('NEW GROUP'), { target: { value: 'Rhythm' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD GROUP' }));
    expect(screen.getByText('ASSIGN CHANNELS BELOW')).toBeInTheDocument();
    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Space');
    await waitFor(() =>
      expect(screen.queryByText('ASSIGN CHANNELS BELOW')).not.toBeInTheDocument(),
    );
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS']);
    expect(screen.getByRole('combobox', { name: 'BASS group' })).toHaveValue(
      screen
        .getByRole('combobox', { name: 'BASS group' })
        .querySelector('option:last-child')
        ?.getAttribute('value'),
    );
  });

  it('drags available channels into the list and into a group', async () => {
    const page = await openSettings({
      id: 'partial',
      name: 'Partial',
      channels: [BASS, { ...MAIN, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    expect(page.availableHandle('main/1')).toBeDisabled();
    expect(page.availableHandle('channel/1')).toBeDisabled();
    expect(page.availableHandle('aux/1')).toBeEnabled();

    // A plain click on the handle is not a click on the label: the checkbox stays as it is.
    fireEvent.click(page.availableHandle('aux/1'));
    expect(screen.getByRole('checkbox', { name: 'FXAUX' })).not.toBeChecked();
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN']);

    await pickUp(page.availableHandle('aux/1'));
    await press('ArrowUp');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'BASS', 'MAIN']));
    expect(screen.getByRole('checkbox', { name: 'FXAUX' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'FX group' })).toHaveValue('');
    expect(page.availableHandle('aux/1')).toBeDisabled();

    await pickUp(page.availableHandle('sub/1'));
    // Picked up level with MAIN's row, the placeholder appears inside the group right away.
    const placeholder = page.container.querySelector('[data-placeholder="true"]');
    expect(placeholder).toHaveAttribute('data-ordered-channel-name', 'SUB');
    expect(page.container.querySelector('[data-view-group-id="g1"]')).toContainElement(
      placeholder as HTMLElement,
    );
    expect(page.container.querySelector('[data-view-group-id="g1"]')).toHaveClass('is-drop-target');
    expect(page.container.querySelector('.channel-checklist')).toHaveClass('is-drag-locked');
    await press('Space');
    await waitFor(() => expect(page.orderedNames()).toEqual(['FX', 'BASS', 'SUB', 'MAIN']));
    expect(page.container.querySelector('[data-placeholder="true"]')).not.toBeInTheDocument();
    expect(page.container.querySelector('.channel-checklist')).not.toHaveClass('is-drag-locked');
    expect(screen.getByRole('combobox', { name: 'SUB group' })).toHaveValue('g1');
    expect(await page.savedChannels()).toEqual([
      FX,
      BASS,
      { ...SUB, groupId: 'g1', color: 'group' },
      { ...MAIN, groupId: 'g1' },
    ]);
  });

  it('cancels with Escape and ignores drops without a target', async () => {
    const page = await openSettings({
      id: 'flat',
      name: 'Flat',
      channels: [BASS, MAIN, FX],
      groups: [],
    });
    const handle = page.handle('BASS');
    await pickUp(handle);
    await press('ArrowDown');
    await press('Escape');
    await waitFor(() => expect(handle).not.toHaveAttribute('aria-pressed'));
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);

    await pickUp(handle);
    await press('Space');
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
    expect(page.viewsClient.calls.filter((call) => call.method === 'update')).toHaveLength(0);
  });

  it('keeps the arrow buttons and the GROUP dropdown working alongside drag and drop', async () => {
    const page = await openSettings({
      id: 'grouped',
      name: 'Grouped',
      channels: [BASS, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }],
      groups: [RHYTHM],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move FX up' }));
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN']);
    fireEvent.change(screen.getByRole('combobox', { name: 'BASS group' }), {
      target: { value: 'g1' },
    });
    expect(page.memberNames('g1')).toEqual(['FX', 'MAIN', 'BASS']);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Rhythm' }));
    expect(page.orderedNames()).toEqual(['FX', 'MAIN', 'BASS']);
    expect(within(page.list()).getAllByRole('button', { name: /^Drag / })).toHaveLength(3);
  });
});

describe('settings drag and drop (mouse sensor)', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
  });

  afterEach(() => {
    restoreLayout();
  });

  // The stub stacks the list below its padding: a group block is its header plus one row per
  // member, every row STUB_ROW_HEIGHT tall. `rowY(n, fraction)` is a point inside the n-th row
  // of that stack (the header counts as row 0), `fraction` of the way down.
  const X = 700;
  const rowY = (row: number, fraction: number) =>
    STUB_LIST_PADDING + (row + fraction) * STUB_ROW_HEIGHT;

  it('takes the first channel of an empty view from AVAILABLE', async () => {
    const page = await openSettings({ id: 'new', name: 'New', channels: [], groups: [] });
    const handle = page.availableHandle('channel/1');

    await pointerDown(handle, 0, STUB_LIST_PADDING + STUB_ROW_HEIGHT * 0.5);
    // The first move only satisfies the activation distance; the sensor ignores its position.
    await pointerMoveTo(0, STUB_LIST_PADDING + STUB_ROW_HEIGHT);
    // Anywhere inside the slot that fills the empty list previews the channel as the first row.
    await pointerMoveTo(X, STUB_LIST_PADDING + STUB_ROW_HEIGHT * 2);
    await waitFor(() => expect(page.orderedNames()).toEqual(['BASS']));
    expect(screen.queryByText('THIS VIEW HAS NO CHANNELS')).toBeNull();

    await pointerUp(X, STUB_LIST_PADDING + STUB_ROW_HEIGHT * 2);
    await waitFor(() => expect(document.querySelector('.drag-overlay')).toBeNull());
    expect(page.orderedNames()).toEqual(['BASS']);
    expect(screen.getByRole('checkbox', { name: /BASS/ })).toBeChecked();
    expect(await page.savedChannels()).toEqual([BASS]);
  });

  it('reaches the last member of a group and the row right after it from below', async () => {
    // Rows: header | MAIN | FX | BASS | SUB
    const page = await openSettings({
      id: 'below',
      name: 'Below',
      channels: [{ ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }, BASS, SUB],
      groups: [RHYTHM],
    });
    await pointerDown(page.handle('SUB'), X, rowY(4, 0.5));
    await pointerMoveTo(X, rowY(4, 0.5) + 6);
    await waitFor(() => expect(document.querySelector('.drag-overlay')).toHaveTextContent('SUB'));
    // Upper half of BASS: SUB lands before it, as the first ungrouped row after the group.
    await pointerMoveTo(X, rowY(3, 0.25));
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'SUB', 'BASS']));
    expect(page.memberNames('g1')).toEqual(['MAIN', 'FX']);
    // Lower half of FX: SUB joins the group as its last member and the list stays put.
    await pointerMoveTo(X, rowY(2, 0.75));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'FX', 'SUB']));
    await pointerMoveTo(X, rowY(2, 0.9));
    expect(page.memberNames('g1')).toEqual(['MAIN', 'FX', 'SUB']);
    await pointerUp(X, rowY(2, 0.9));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'FX', 'SUB']));
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...FX, groupId: 'g1' },
      { ...SUB, groupId: 'g1', color: 'group' },
      BASS,
    ]);
  });

  it('reaches the same two places from above, entering the group at its top', async () => {
    // Rows: SUB | header | MAIN | FX | BASS
    const page = await openSettings({
      id: 'above',
      name: 'Above',
      channels: [SUB, { ...MAIN, groupId: 'g1' }, { ...FX, groupId: 'g1' }, BASS],
      groups: [RHYTHM],
    });
    await pointerDown(page.handle('SUB'), X, rowY(0, 0.5));
    await pointerMoveTo(X, rowY(0, 0.5) + 6);
    await waitFor(() => expect(document.querySelector('.drag-overlay')).toHaveTextContent('SUB'));
    // The group header (upper half of the block, below the root slot band): SUB becomes the
    // first member, and the list moves up so the placeholder sits under the pointer.
    await pointerMoveTo(X, rowY(1, 0.75));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['SUB', 'MAIN', 'FX']));
    // Rows now: header | SUB | MAIN | FX | BASS. Lower half of MAIN, then lower half of FX.
    await pointerMoveTo(X, rowY(2, 0.75));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'SUB', 'FX']));
    await pointerMoveTo(X, rowY(3, 0.75));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'FX', 'SUB']));
    // Upper half of BASS: SUB leaves the group and stands right after it.
    await pointerMoveTo(X, rowY(4, 0.25));
    await waitFor(() => expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'SUB', 'BASS']));
    expect(page.memberNames('g1')).toEqual(['MAIN', 'FX']);
    await pointerUp(X, rowY(4, 0.25));
    await waitFor(() => expect(document.querySelector('.drag-overlay')).toBeNull());
    expect(page.orderedNames()).toEqual(['MAIN', 'FX', 'SUB', 'BASS']);
    expect(screen.getByRole('combobox', { name: 'SUB group' })).toHaveValue('');
    expect(await page.savedChannels()).toEqual([
      { ...MAIN, groupId: 'g1' },
      { ...FX, groupId: 'g1' },
      SUB,
      BASS,
    ]);
  });
});

describe('settings drag and drop (touch sensor)', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    // dnd-kit removes its capturing click blocker from the document on a timeout; leaving it
    // installed would swallow the first click of the next test.
    await advanceTouchDelay(TOUCH_ACTIVATION_DELAY_MS);
    vi.useRealTimers();
    restoreLayout();
  });

  const X = 700;
  const rowY = (row: number, fraction: number) =>
    STUB_LIST_PADDING + (row + fraction) * STUB_ROW_HEIGHT;
  const view: View = { id: 'v1', name: 'Stage', channels: [BASS, MAIN, FX], groups: [] };

  it('starts a drag only after the finger has rested on the handle', async () => {
    const page = await openSettings(view);
    const handle = page.handle('BASS');

    await touchStart(handle, X, rowY(0, 0.5));
    expect(document.querySelector('.drag-overlay')).toBeNull();

    await advanceTouchDelay(TOUCH_ACTIVATION_DELAY_MS);
    expect(document.querySelector('.drag-overlay')).not.toBeNull();

    // Lower half of MAIN: BASS lands after it, the same midline rule the mouse follows.
    await touchMove(handle, X, rowY(1, 0.75));
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']);
    await touchEnd(handle, X, rowY(1, 0.75));
    expect(page.orderedNames()).toEqual(['MAIN', 'BASS', 'FX']);
    // dnd-kit swallows clicks for a moment after a drop; let that window pass before saving.
    await advanceTouchDelay(TOUCH_ACTIVATION_DELAY_MS);
    expect(await page.savedChannels()).toEqual([MAIN, BASS, FX]);
  });

  it('reads a finger that moves past the tolerance as a scroll and never starts', async () => {
    const page = await openSettings(view);
    const handle = page.handle('BASS');

    await touchStart(handle, X, rowY(0, 0.5));
    await touchMove(handle, X, rowY(0, 0.5) + TOUCH_ACTIVATION_TOLERANCE_PX + 1);
    await advanceTouchDelay(TOUCH_ACTIVATION_DELAY_MS * 2);

    expect(document.querySelector('.drag-overlay')).toBeNull();
    await touchEnd(handle, X, rowY(0, 0.5) + TOUCH_ACTIVATION_TOLERANCE_PX + 1);
    expect(page.orderedNames()).toEqual(['BASS', 'MAIN', 'FX']);
  });
});
