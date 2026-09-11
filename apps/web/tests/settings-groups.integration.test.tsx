import { SOCKET_EVENTS, type MixerSnapshot, type View } from '@flwc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { resetMeterStore } from '../src/store/meter-store.js';
import { resetMixerStore } from '../src/store/mixer-store.js';
import { resetViewStore } from '../src/store/view-store.js';
import { FakeSocket } from './fake-socket.js';
import { FakeViewsClient } from './fake-views-client.js';
import { channelGroup as grp, channelRow as row } from './view-fixtures.js';
import { pickUp, press } from './keyboard-drag.js';
import { stubListLayout } from './stub-layout.js';
import { CHANNEL_PALETTE } from '../src/features/mixer/channel-colors.js';

const snapshot: MixerSnapshot = {
  channels: [
    { id: 'channel/1', kind: 'channel', name: 'BASS', levelDb: -12, muted: false, meterDb: -30 },
    { id: 'main/1', kind: 'main', name: 'MAIN', levelDb: -6, muted: false, meterDb: -20 },
    { id: 'aux/1', kind: 'aux', name: 'FX', levelDb: -8, muted: true, meterDb: -40 },
    { id: 'sub/1', kind: 'sub', name: 'SUB', levelDb: -10, muted: false, meterDb: -35 },
    { id: 'aux/2', kind: 'aux', name: 'REV', levelDb: -14, muted: false, meterDb: -45 },
  ],
  loudness: { integratedLufs: -23, truePeakDbtp: -3 },
  connection: 'connected',
};

const BASS = { kind: 'channel', name: 'BASS', channelId: 'channel/1' } as const;
const MAIN = { kind: 'main', name: 'MAIN', channelId: 'main/1' } as const;
const FX = { kind: 'aux', name: 'FX', channelId: 'aux/1' } as const;
const SUB = { kind: 'sub', name: 'SUB', channelId: 'sub/1' } as const;
const REV = { kind: 'aux', name: 'REV', channelId: 'aux/2' } as const;
const RHYTHM = { id: 'g1', name: 'Rhythm' };

async function openSettings(views: View[]) {
  const socket = new FakeSocket();
  const viewsClient = new FakeViewsClient(views);
  const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
  socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
  const first = views[0];
  if (first !== undefined) {
    await screen.findByRole('option', { name: first.name });
  }
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
  const savedItems = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SAVE VIEW' }));
    await waitFor(() => expect(viewsClient.calls.at(-1)?.method).toBe('update'));
    return viewsClient.calls.at(-1)?.body?.items;
  };
  return {
    container,
    viewsClient,
    list,
    orderedNames,
    memberNames,
    handle,
    availableHandle,
    savedItems,
  };
}

const grouped: View = {
  id: 'v1',
  name: 'Stage',
  items: [grp(RHYTHM, [BASS, MAIN]), row(FX)],
};

describe('settings group collapse', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
    return () => restoreLayout();
  });

  it('folds a group shut and back open', async () => {
    const page = await openSettings([grouped]);
    const toggle = () => screen.getByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName('Expand group Rhythm');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(page.memberNames('g1')).toEqual([]);
    // The header keeps its member count, so the rows are hidden rather than gone.
    expect(within(page.list()).getByText('02 CH')).toBeInTheDocument();
    // The ungrouped row is untouched.
    expect(page.orderedNames()).toEqual(['FX']);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']);
  });

  it('gives an empty group no collapse button', async () => {
    await openSettings([{ id: 'v2', name: 'Empty', items: [grp(RHYTHM)] }]);
    expect(screen.queryByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ })).toBeNull();
    expect(screen.getByText('ASSIGN CHANNELS BELOW')).toBeInTheDocument();
  });

  it('forgets the collapsed groups when another view is selected', async () => {
    const other: View = { id: 'v2', name: 'Other', items: [row(SUB)] };
    const page = await openSettings([grouped, other]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));
    expect(page.memberNames('g1')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    await waitFor(() => expect(page.orderedNames()).toEqual(['SUB']));
    fireEvent.click(screen.getByRole('button', { name: /Stage/ }));
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['BASS', 'MAIN']));
  });

  it('does not fold a group shut again after it has been emptied and refilled', async () => {
    const page = await openSettings([grouped]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));
    expect(page.memberNames('g1')).toEqual([]);

    // Emptying the group through the AVAILABLE checkboxes leaves it with nothing to fold.
    for (const name of ['BASS', 'MAIN']) {
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(name) }));
    }
    expect(page.orderedNames()).toEqual(['FX']);
    expect(screen.getByText('ASSIGN CHANNELS BELOW')).toBeInTheDocument();

    // Putting a channel back must show it rather than hide it inside a still-collapsed group.
    fireEvent.change(screen.getByRole('combobox', { name: 'FX group' }), {
      target: { value: 'g1' },
    });
    expect(page.memberNames('g1')).toEqual(['FX']);
    expect(screen.getByRole('button', { name: 'Collapse group Rhythm' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps every header control usable while a group is collapsed', async () => {
    const page = await openSettings([grouped]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));
    expect(page.memberNames('g1')).toEqual([]);

    // Renaming reaches the group and the collapse button follows the new name.
    fireEvent.change(screen.getByRole('textbox', { name: 'Group 1 name' }), {
      target: { value: 'Low End' },
    });
    expect(screen.getByRole('button', { name: 'Expand group Low End' })).toBeInTheDocument();

    // The arrow buttons still move the whole block.
    fireEvent.click(screen.getByRole('button', { name: 'Move group Low End down' }));
    expect(await page.savedItems()).toEqual([
      row(FX),
      grp({ ...RHYTHM, name: 'Low End' }, [BASS, MAIN]),
    ]);

    // UNGROUP releases the members in place and shows them again.
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Low End' }));
    expect(page.orderedNames()).toEqual(['FX', 'BASS', 'MAIN']);
  });

  it('moves a collapsed group as a whole with its handle', async () => {
    const page = await openSettings([grouped]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse group Rhythm' }));

    await pickUp(page.handle('group Rhythm'));
    await press('ArrowDown');
    await press('Space');
    await waitFor(() =>
      expect(page.savedItems()).resolves.toEqual([row(FX), grp(RHYTHM, [BASS, MAIN])]),
    );
  });

  it('opens a collapsed group as soon as a drag previews into it', async () => {
    const page = await openSettings([grouped]);
    const toggle = () => screen.getByRole('button', { name: /^(Collapse|Expand) group Rhythm$/ });
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    // A collapsed group has no rows to stand for it, so it is a keyboard stop in its own right.
    await pickUp(page.handle('FX'));
    await press('ArrowUp');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(page.memberNames('g1')).toEqual(['FX', 'BASS', 'MAIN']);

    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['FX', 'BASS', 'MAIN']));
    // The group stays open after the drop.
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(await page.savedItems()).toEqual([
      // FX joined the group, so its automatic colour becomes "follow the group".
      grp(RHYTHM, [{ ...FX, color: 'group' }, BASS, MAIN]),
    ]);
  });
});

describe('settings group colours', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    window.localStorage.clear();
    resetMixerStore();
    resetMeterStore();
    resetViewStore();
    restoreLayout = stubListLayout();
    return () => restoreLayout();
  });

  const accentOf = (row: Element | null) =>
    (row as HTMLElement | null)?.style.getPropertyValue('--channel-row-accent');
  const rowOf = (container: HTMLElement, name: string) =>
    container.querySelector(`.view-channel-list [data-ordered-channel-name="${name}"]`);

  it('switches a row between automatic, group and a colour of its own', async () => {
    const page = await openSettings([
      { id: 'v1', name: 'Stage', items: [row(BASS), row(MAIN), grp(RHYTHM)] },
    ]);
    // Outside a group there is nothing to follow, so GROUP is not offered.
    expect(screen.queryByRole('button', { name: 'BASS use group color' })).toBeNull();
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.green);

    // Joining a group turns the automatic colour into GROUP.
    fireEvent.change(screen.getByRole('combobox', { name: 'BASS group' }), {
      target: { value: 'g1' },
    });
    const groupButton = screen.getByRole('button', { name: 'BASS use group color' });
    expect(groupButton).toHaveClass('is-selected');
    // The choice is spelled out rather than drawn: a swatch would repeat the group's own colour
    // and leave two identical squares side by side.
    expect(groupButton).toHaveTextContent('GRP');
    expect(groupButton.querySelector('span')).toBeNull();
    expect(screen.getByRole('button', { name: 'BASS use default color' })).not.toHaveClass(
      'is-selected',
    );
    // The group has no colour of its own yet, so it follows its first present member: an input.
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.green);

    // Colouring the group repaints the row that follows it.
    fireEvent.click(screen.getByRole('button', { name: 'Group Rhythm color Matrix Purple' }));
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.purple);

    // Picking a colour by hand overrides the group.
    fireEvent.click(screen.getByRole('button', { name: 'BASS color Mix Minus Lime' }));
    expect(groupButton).not.toHaveClass('is-selected');
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.lime);

    // And that choice survives leaving the group, where GROUP disappears again.
    fireEvent.change(screen.getByRole('combobox', { name: 'BASS group' }), {
      target: { value: '' },
    });
    expect(screen.queryByRole('button', { name: 'BASS use group color' })).toBeNull();
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.lime);

    // Joining the group moved BASS to the end of its run; leaving it dropped it just below the
    // group block, which is where the row already was.
    expect(await page.savedItems()).toEqual([
      row(MAIN),
      grp({ ...RHYTHM, color: 'purple' }),
      row({ ...BASS, color: 'lime' }),
    ]);
  });

  it('drops a row back to automatic when it is dragged out of its group', async () => {
    const page = await openSettings([
      {
        id: 'v1',
        name: 'Stage',
        items: [grp({ ...RHYTHM, color: 'teal' }, [{ ...BASS, color: 'group' }]), row(MAIN)],
      },
    ]);
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.teal);
    expect(screen.getByRole('button', { name: 'BASS use group color' })).toHaveClass('is-selected');

    await pickUp(page.handle('BASS'));
    await press('ArrowDown');
    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual([]));
    expect(screen.queryByRole('button', { name: 'BASS use group color' })).toBeNull();
    expect(screen.getByRole('button', { name: 'BASS use default color' })).toHaveClass(
      'is-selected',
    );
    expect(accentOf(rowOf(page.container, 'BASS'))).toBe(CHANNEL_PALETTE.green);
    // A keyboard drag into another list lands before the row it reaches.
    expect(await page.savedItems()).toEqual([
      grp({ ...RHYTHM, color: 'teal' }),
      row(BASS),
      row(MAIN),
    ]);
  });

  it('colours a group by the kind most of its members are', async () => {
    const page = await openSettings([
      {
        id: 'v1',
        name: 'Stage',
        // One main against two auxes: the auxes have it.
        items: [
          grp(RHYTHM, [
            { ...MAIN, color: 'group' },
            { ...FX, color: 'group' },
            { ...REV, color: 'group' },
          ]),
        ],
      },
    ]);
    const header = page.container.querySelector('[data-view-group-id="g1"]') as HTMLElement;
    expect(header.style.getPropertyValue('--channel-row-accent')).toBe(CHANNEL_PALETTE.navy);
    // Every row following the group reads the same answer.
    expect(accentOf(rowOf(page.container, 'MAIN'))).toBe(CHANNEL_PALETTE.navy);
    expect(accentOf(rowOf(page.container, 'FX'))).toBe(CHANNEL_PALETTE.navy);

    // Take one aux out: one main against one aux is a tie, and main comes first.
    await pickUp(page.handle('REV'));
    await press('ArrowDown');
    await press('Space');
    await waitFor(() => expect(page.memberNames('g1')).toEqual(['MAIN', 'FX']));
    expect(header.style.getPropertyValue('--channel-row-accent')).toBe(CHANNEL_PALETTE.red);
    expect(accentOf(rowOf(page.container, 'MAIN'))).toBe(CHANNEL_PALETTE.red);
  });

  it('keeps the drag clone on the colour the row was picked up with', async () => {
    const page = await openSettings([
      {
        id: 'v1',
        name: 'Stage',
        // A teal group above a loose row: the clone must stay teal while it is dragged out.
        items: [grp({ ...RHYTHM, color: 'teal' }, [{ ...MAIN, color: 'group' }]), row(BASS)],
      },
    ]);
    const overlayAccent = () =>
      (document.querySelector('.drag-overlay') as HTMLElement | null)?.style.getPropertyValue(
        '--channel-row-accent',
      );

    await pickUp(page.handle('MAIN'));
    expect(overlayAccent()).toBe(CHANNEL_PALETTE.teal);

    // Previewing it out of the group moves a different row to the index it was picked up at;
    // the clone must still read the group MAIN came from, not whatever sits there now.
    await press('ArrowDown');
    await waitFor(() => expect(page.memberNames('g1')).toEqual([]));
    expect(overlayAccent()).toBe(CHANNEL_PALETTE.teal);
    await press('Escape');
  });

  it('paints the mixer group section with the same dominant colour', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'v1',
        name: 'Stage',
        items: [grp(RHYTHM, [MAIN, FX, REV])],
      },
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'v1' },
    });
    const section = container.querySelector('[data-view-group-id="g1"]') as HTMLElement;
    expect(section.style.getPropertyValue('--channel-accent')).toBe(CHANNEL_PALETTE.navy);
  });

  it('clears a group colour back to the kind most of its members are', async () => {
    const page = await openSettings([
      {
        id: 'v1',
        name: 'Stage',
        items: [grp({ ...RHYTHM, color: 'lime' }, [{ ...MAIN, color: 'group' }])],
      },
    ]);
    expect(accentOf(rowOf(page.container, 'MAIN'))).toBe(CHANNEL_PALETTE.lime);
    fireEvent.click(screen.getByRole('button', { name: 'Group Rhythm use automatic color' }));
    expect(accentOf(rowOf(page.container, 'MAIN'))).toBe(CHANNEL_PALETTE.red);
    expect(await page.savedItems()).toEqual([grp(RHYTHM, [{ ...MAIN, color: 'group' }])]);
  });

  it('paints the mixer group section with the same colour', async () => {
    const socket = new FakeSocket();
    const viewsClient = new FakeViewsClient([
      {
        id: 'v1',
        name: 'Stage',
        items: [
          grp({ ...RHYTHM, color: 'purple' }, [
            { ...MAIN, color: 'group' },
            { ...BASS, color: 'group' },
          ]),
        ],
      },
    ]);
    const { container } = render(<App socket={socket} viewsClient={viewsClient} />);
    socket.serverEmit(SOCKET_EVENTS.MIXER_SNAPSHOT, snapshot);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Mixer view' }), {
      target: { value: 'v1' },
    });

    const section = container.querySelector<HTMLElement>('[data-view-group-id="g1"]');
    expect(section?.style.getPropertyValue('--channel-accent')).toBe(CHANNEL_PALETTE.purple);
    const strips = [...container.querySelectorAll<HTMLElement>('article.channel-strip')];
    expect(strips).toHaveLength(2);
    for (const strip of strips) {
      expect(strip.style.getPropertyValue('--channel-accent')).toBe(CHANNEL_PALETTE.purple);
    }
  });
});
