import {
  CHANNEL_KINDS,
  viewChannelRefs,
  viewGroups,
  type ChannelKind,
  type ViewGroup,
} from '@flwc/shared';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import type { ControlClient } from '../../lib/socket.js';
import { mixerStore } from '../../store/mixer-store.js';
import { viewStore } from '../../store/view-store.js';
import { LoudnessPanel } from '../loudness/LoudnessPanel.js';
import { channelAccent, channelTypeColor, groupAccent } from './channel-colors.js';
import { ChannelStrip } from './ChannelStrip.js';
import { ControlLock } from './ControlLock.js';
import { EmptyConsole } from './EmptyConsole.js';
import { resolveMixerEmptyState } from './empty-state.js';
import { MissingChannelStrip } from './MissingChannelStrip.js';
import {
  PAGE_RAIL_WIDTH_PX,
  PAGE_TRANSITION_MS,
  SECTION_HEADER_WIDTH_PX,
  SEGMENT_GAP_PX,
  STRIP_GAP_PX,
  STRIP_MIN_HEIGHT_PX,
  STRIP_WIDTH_PX,
} from './page-layout.js';
import { paginate, type LayoutSegment } from './pagination.js';
import { StripPages, type SegmentChrome, type StripStub } from './StripPages.js';
import { TypeRowToggle } from './TypeRowToggle.js';
import { useChannelPresence, type PresenceChannel } from './use-channel-presence.js';
import { useControlLockPreference } from './use-control-lock-preference.js';
import { usePager } from './use-pager.js';
import { usePagerViewport } from './use-pager-viewport.js';
import { useTypeRowsPreference } from './use-type-row-preference.js';
import {
  resolveViewChannels,
  segmentViewChannels,
  type ResolvedViewChannel,
} from './view-resolver.js';
import { ViewSelector } from './ViewSelector.js';

const SECTION_LABELS: Record<ChannelKind, string> = {
  channel: 'INPUTS',
  main: 'MAIN',
  sub: 'SUB',
  aux: 'AUX',
  mixm: 'MIX MINUS',
  mtx: 'MATRIX',
};

const EMPTY_RESOLVED: ResolvedViewChannel[] = [];

/** The geometry the pager and the stylesheet share, published once on the shell. */
const LAYOUT_VARIABLES = {
  '--strip-width': `${STRIP_WIDTH_PX}px`,
  '--section-header-width': `${SECTION_HEADER_WIDTH_PX}px`,
  '--strip-gap': `${STRIP_GAP_PX}px`,
  '--segment-gap': `${SEGMENT_GAP_PX}px`,
  '--strip-min-height': `${STRIP_MIN_HEIGHT_PX}px`,
  '--page-rail-width': `${PAGE_RAIL_WIDTH_PX}px`,
  '--page-transition': `${PAGE_TRANSITION_MS}ms`,
} as CSSProperties;

interface MixerPageProps {
  controlClient: ControlClient;
  onOpenSettings(): void;
  onOpenConnection(): void;
}

export function MixerPage({ controlClient, onOpenSettings, onOpenConnection }: MixerPageProps) {
  const channels = useStore(
    mixerStore,
    useShallow((state) =>
      state.channelOrder.map((id) => state.channels[id]).filter((channel) => channel !== undefined),
    ),
  );
  const { channelInventoryLoaded, socketConnected, emberStatus, emberLastError } = useStore(
    mixerStore,
    useShallow((state) => ({
      channelInventoryLoaded: state.channelInventoryLoaded,
      socketConnected: state.socketConnected,
      emberStatus: state.emberStatus,
      emberLastError: state.emberLastError,
    })),
  );
  const { views, activeViewId } = useStore(
    viewStore,
    useShallow((state) => ({ views: state.views, activeViewId: state.activeViewId })),
  );
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const resolvedView = useMemo(
    () => (activeView === null ? EMPTY_RESOLVED : resolveViewChannels(activeView, channels)),
    [activeView, channels],
  );
  const viewChannels = useMemo(
    () => resolvedView.map((entry) => entry.channel).filter((channel) => channel !== undefined),
    [resolvedView],
  );
  const renderedChannels = useChannelPresence(activeView === null ? channels : viewChannels);
  const renderedById = new Map(renderedChannels.map((item) => [item.channel.id, item]));
  // Live channels already resolved to a reference; rendered strips outside this set are on
  // their way out and may still be shown for the reference they last belonged to.
  const claimedIds = new Set(
    resolvedView.map((entry) => entry.channel?.id).filter((id) => id !== undefined),
  );
  const liveIds = new Set(channels.map((channel) => channel.id));
  const [typePages, toggleTypePages] = useTypeRowsPreference();
  const [lockMode, setLockMode] = useControlLockPreference();
  const viewHasGroups = activeView !== null && viewGroups(activeView).length > 0;
  const emptyState = resolveMixerEmptyState({
    socketConnected,
    emberStatus,
    emberLastError,
    channelInventoryLoaded,
    channelCount: renderedChannels.length,
    viewChannelCount: activeView === null ? null : viewChannelRefs(activeView).length,
  });

  const { width: viewportWidth, attach: attachViewport } = usePagerViewport();

  const renderViewStrip = (
    entry: ResolvedViewChannel,
    position: number,
    // The group a strip belongs to, so a colour of `'group'` resolves the same as in the editor.
    group?: ViewGroup,
  ): ReactNode => {
    const { reference, channel, index } = entry;
    let item: PresenceChannel | undefined;
    if (channel !== undefined) {
      item = renderedById.get(channel.id) ?? { channel, exiting: false };
    } else {
      // Keep the exit animation of the strip that just disappeared from the inventory. It is
      // matched by kind and name, not by the persisted id, which Fairlight may have renumbered,
      // and only while its id is really gone: a renamed strip must not be borrowed, and the
      // borrowed strip is always shown disabled so it can never control another channel.
      const leaving = renderedChannels.find(
        (candidate) =>
          !claimedIds.has(candidate.channel.id) &&
          !liveIds.has(candidate.channel.id) &&
          candidate.channel.kind === reference.kind &&
          candidate.channel.name.trim() === reference.name.trim(),
      );
      if (leaving !== undefined) {
        claimedIds.add(leaving.channel.id);
        item = { channel: leaving.channel, exiting: true };
      }
    }
    if (item === undefined) {
      return (
        <MissingChannelStrip
          key={`ref-${index}`}
          reference={reference}
          index={position}
          group={group}
        />
      );
    }
    return (
      <ChannelStrip
        key={`ref-${index}`}
        item={item}
        controlClient={controlClient}
        lockMode={lockMode}
        style={
          {
            '--strip-index': position,
            '--channel-accent': channelAccent(item.channel.kind, reference.color, group),
          } as CSSProperties
        }
      />
    );
  };

  // The pager works on segments of render stubs: the same continuous runs the console has always
  // drawn, but sliced into pages by measured width rather than wrapped by the browser.
  const segments: LayoutSegment<StripStub>[] = [];
  const chrome = new Map<string, SegmentChrome>();

  if (activeView === null) {
    for (const kind of CHANNEL_KINDS) {
      const group = renderedChannels.filter(({ channel }) => channel.kind === kind);
      if (group.length === 0) {
        continue;
      }
      const key = `kind-${kind}`;
      chrome.set(key, {
        headingId: `section-${kind}`,
        label: SECTION_LABELS[kind],
        count: group.filter((item) => !item.exiting).length,
        accent: channelTypeColor(kind),
        channelKind: kind,
      });
      segments.push({
        key,
        header: true,
        entries: group.map((item) => ({
          key: item.channel.id,
          render: (position: number) => (
            <ChannelStrip
              key={item.channel.id}
              item={item}
              controlClient={controlClient}
              lockMode={lockMode}
              style={{ '--strip-index': position } as CSSProperties}
            />
          ),
        })),
      });
    }
  } else {
    for (const segment of segmentViewChannels(activeView, resolvedView)) {
      const first = segment.entries[0];
      if (first === undefined) {
        continue;
      }
      const { group } = segment;
      if (group === undefined) {
        segments.push({
          key: `loose-${first.index}`,
          header: false,
          entries: segment.entries.map((entry) => ({
            key: `ref-${entry.index}`,
            render: (position: number) => renderViewStrip(entry, position),
          })),
        });
        continue;
      }
      const key = `group-${group.id}-${first.index}`;
      chrome.set(key, {
        headingId: `view-group-${group.id}-${first.index}`,
        label: group.name,
        count: segment.entries.filter((entry) => entry.channel !== undefined).length,
        accent: groupAccent(group),
        viewGroupId: group.id,
      });
      segments.push({
        key,
        header: true,
        entries: segment.entries.map((entry) => ({
          key: `ref-${entry.index}`,
          render: (position: number) => renderViewStrip(entry, position, group),
        })),
      });
    }
  }

  const showTypePages = activeView === null || viewHasGroups;
  const pages = paginate(
    segments,
    {
      containerWidth: viewportWidth,
      stripWidth: STRIP_WIDTH_PX,
      headerWidth: SECTION_HEADER_WIDTH_PX,
      stripGap: STRIP_GAP_PX,
      segmentGap: SEGMENT_GAP_PX,
    },
    { newPagePerHeaderedSegment: typePages && showTypePages },
  );
  const pager = usePager(Math.max(1, pages.length), activeViewId);

  return (
    <main className="mixer-shell" data-theme="dark" style={LAYOUT_VARIABLES}>
      <header className="console-header">
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE</span>
          <h1>CONTROL DESK</h1>
          <button type="button" className="console-brand__action" onClick={onOpenSettings}>
            CONFIGURE VIEWS
          </button>
        </div>
        <ConnectionStatus onOpen={onOpenConnection} />
        <div className="console-preferences">
          <ViewSelector />
          {showTypePages && (
            <TypeRowToggle
              enabled={typePages}
              onToggle={toggleTypePages}
              label={
                activeView === null
                  ? 'Start each channel type on a new page'
                  : 'Start each group on a new page'
              }
            />
          )}
          <ControlLock mode={lockMode} onChange={setLockMode} />
        </div>
        <LoudnessPanel controlClient={controlClient} />
      </header>

      {emptyState !== null ? (
        <EmptyConsole state={emptyState} onOpenConnection={onOpenConnection} />
      ) : (
        <div className="mixer-deck">
          <div className="mixer-bays" ref={attachViewport} data-view-id={activeView?.id}>
            <StripPages pages={pages} chrome={chrome} pageIndex={pager.pageIndex} />
          </div>
        </div>
      )}
      <footer className="console-footer">
        <span>EMBER+ REMOTE</span>
        <span>LEVEL −100 / +10 dB</span>
        <span>FRAME 20 Hz</span>
      </footer>
    </main>
  );
}
