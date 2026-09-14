import {
  CHANNEL_KINDS,
  viewChannelRefs,
  viewGroups,
  type ChannelKind,
  type ViewGroup,
} from '@flwc/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { WheelGestures, type WheelEventState } from 'wheel-gestures';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import { INITIAL_PAGE_WHEEL_STATE, reducePageWheel } from '../../lib/page-wheel.js';
import type { ControlClient } from '../../lib/socket.js';
import { pagingDelta } from '../../lib/wheel-delta.js';
import { sameOwner, wheelGestureTracker } from '../../lib/wheel-gesture.js';
import { mixerStore } from '../../store/mixer-store.js';
import { viewStore } from '../../store/view-store.js';
import { LoudnessPanel } from '../loudness/LoudnessPanel.js';
import { channelAccent, channelTypeColor, groupAccent } from './channel-colors.js';
import { ChannelStrip } from './ChannelStrip.js';
import { ControlLock } from './ControlLock.js';
import { EmptyConsole } from './EmptyConsole.js';
import { resolveMixerEmptyState } from './empty-state.js';
import { MissingChannelStrip } from './MissingChannelStrip.js';
import { PageRail } from './PageRail.js';
import { fitPages } from './page-fit.js';
import {
  PAGE_PADDING_X_PX,
  PAGE_RAIL_WIDTH_PX,
  PAGE_TRANSITION_MS,
  SECTION_HEADER_GAP_PX,
  SECTION_HEADER_HEIGHT_PX,
  SEGMENT_GAP_MAX_PX,
  SEGMENT_GAP_PX,
  STRIP_GAP_MAX_PX,
  STRIP_GAP_PX,
  STRIP_MIN_HEIGHT_PX,
  STRIP_WIDTH_MAX_PX,
  STRIP_WIDTH_PX,
} from './page-layout.js';
import { paginate, type LayoutSegment } from './pagination.js';
import { StripPages, type SegmentChrome, type StripStub } from './StripPages.js';
import { TypeRowToggle } from './TypeRowToggle.js';
import { useChannelPresence, type PresenceChannel } from './use-channel-presence.js';
import { useControlLockPreference } from './use-control-lock-preference.js';
import { usePager } from './use-pager.js';
import { usePagerViewport } from './use-pager-viewport.js';
import { useFullscreen } from '../../lib/use-fullscreen.js';
import { useTypeRowsPreference } from './use-type-row-preference.js';
import { useWakeLock } from './use-wake-lock.js';
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
  '--section-header-height': `${SECTION_HEADER_HEIGHT_PX}px`,
  '--section-header-gap': `${SECTION_HEADER_GAP_PX}px`,
  '--strip-gap': `${STRIP_GAP_PX}px`,
  '--segment-gap': `${SEGMENT_GAP_PX}px`,
  '--strip-min-height': `${STRIP_MIN_HEIGHT_PX}px`,
  '--page-padding-x': `${PAGE_PADDING_X_PX}px`,
  '--page-rail-width': `${PAGE_RAIL_WIDTH_PX}px`,
  '--page-transition': `${PAGE_TRANSITION_MS}ms`,
} as CSSProperties;

/** The pager has nothing to finish when its gesture ends; the fader is the one that commits. */
const NO_GESTURE_END = () => {};

/** Whether a page that scrolls has run out of room the way the wheel is going. */
function atScrollEnd(scroller: Element, delta: number): boolean {
  if (delta === 0) {
    return false;
  }
  return delta < 0
    ? scroller.scrollTop <= 0
    : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
}

/** The page in view, which is the one that scrolls when the viewport is too short for it. */
function currentScroller(viewport: HTMLElement | null): Element | null {
  return viewport?.querySelector('.mixer-page[data-current]') ?? null;
}

/** Whether the page in view still has somewhere to scroll the way the travel is going. */
function pageScrolls(scroller: Element | null, delta: number): boolean {
  return (
    scroller !== null &&
    scroller.scrollHeight > scroller.clientHeight &&
    !atScrollEnd(scroller, delta)
  );
}

/**
 * Whether the travel started on the safe strip. Nothing there scrolls, so a wheel or a finger on
 * it always means the page — the one surface an operator may touch must never come up dead.
 */
function inRail(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.page-rail') !== null;
}

/**
 * The event behind a reading, or null when there is none to act on. A gesture also publishes a
 * last reading from a timer once the wheel falls silent; that one carries the event before it,
 * which was handled when it arrived, and no travel of its own.
 */
function liveWheelEvent(state: WheelEventState): WheelEvent | null {
  return !state.isEnding && state.event instanceof WheelEvent ? state.event : null;
}

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
  /*
   * The screen is held awake only while there is a desk on the other end. The tablet is charged
   * from the machine running the server, so when that machine is shut down the mixer goes away
   * and the tablet should be allowed to sleep rather than sit there lit all night. When the
   * machine comes back the tablet wakes on its own (charging), the socket reconnects, and this
   * turns back on by itself. The settings page never holds the screen at all.
   */
  const deskOnline = socketConnected && emberStatus === 'connected';
  const wakeLockStatus = useWakeLock(deskOnline);
  const fullscreen = useFullscreen();
  const viewHasGroups = activeView !== null && viewGroups(activeView).length > 0;
  const emptyState = resolveMixerEmptyState({
    socketConnected,
    emberStatus,
    emberLastError,
    channelInventoryLoaded,
    channelCount: renderedChannels.length,
    viewChannelCount: activeView === null ? null : viewChannelRefs(activeView).length,
  });

  const { width: viewportWidth, attach: attachViewport, node: viewportNode } = usePagerViewport();
  const [deckNode, setDeckNode] = useState<HTMLDivElement | null>(null);
  const pageWheelRef = useRef(INITIAL_PAGE_WHEEL_STATE);
  const touchRef = useRef<{ lastY: number; turned: boolean } | null>(null);
  // What the wheel and touch handlers need but must not be re-subscribed for. Telling a finger
  // from a coast takes a run of events, so the detector has to outlive a change of page count:
  // tearing it down mid-flick would forget that this travel is the tail of one.
  const pagerRef = useRef({ viewportNode, nextPage: () => {}, previousPage: () => {} });

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
  // A page's side padding comes out of its width, so it is not room for strips: hand the pager
  // the content box or the last strip on a full page is laid out past the clip.
  const containerWidth = Math.max(0, viewportWidth - 2 * PAGE_PADDING_X_PX);
  const pages = paginate(
    segments,
    {
      containerWidth,
      stripWidth: STRIP_WIDTH_PX,
      stripGap: STRIP_GAP_PX,
      segmentGap: SEGMENT_GAP_PX,
    },
    { newPagePerHeaderedSegment: typePages && showTypePages },
  );
  // Pages are split at the narrowest geometry there is; this spends what that leaves over.
  const fit = fitPages(pages, {
    containerWidth,
    stripWidth: STRIP_WIDTH_PX,
    stripWidthMax: STRIP_WIDTH_MAX_PX,
    stripGap: STRIP_GAP_PX,
    stripGapMax: STRIP_GAP_MAX_PX,
    segmentGap: SEGMENT_GAP_PX,
    segmentGapMax: SEGMENT_GAP_MAX_PX,
  });
  const pageCount = Math.max(1, pages.length);
  const pager = usePager(pageCount, activeViewId);
  const { next: nextPage, previous: previousPage } = pager;

  useEffect(() => {
    pagerRef.current = { viewportNode, nextPage, previousPage };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'PageDown' && event.key !== 'PageUp')) {
        return;
      }
      // A focused fader owns PageUp and PageDown as its coarse step; so does anything being
      // typed into. The fader marks the event handled, but check the target too so a control
      // that never calls preventDefault still keeps its keys.
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest('[role="slider"], input, select, textarea, [contenteditable]') !== null
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === 'PageDown') {
        nextPage();
      } else {
        previousPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nextPage, previousPage]);

  // The pager listens across the whole deck, so the gaps between strips and the rail turn pages
  // too. It only ever learns about faders through the gesture tracker, never directly.
  useEffect(() => {
    if (deckNode === null) {
      return;
    }
    const handleWheel = (wheel: WheelEventState) => {
      const event = liveWheelEvent(wheel);
      if (event === null) {
        return;
      }
      const { target } = event;
      const onTrack = target instanceof Element && target.closest('[data-wheel="level"]') !== null;
      const owner = wheelGestureTracker.owner();
      if (owner !== null && !sameOwner(owner, 'page')) {
        // A fader owns this gesture, even if the pointer has since left its track.
        wheelGestureTracker.touch();
        event.preventDefault();
        return;
      }
      if (owner === null) {
        // A fader track keeps its own wheel unless Shift asks for the pager instead.
        if (onTrack && !event.shiftKey) {
          return;
        }
        if (!sameOwner(wheelGestureTracker.begin('page', NO_GESTURE_END), 'page')) {
          return;
        }
      }
      // Too short a viewport leaves the page taller than the space for it; scrolling to see the
      // rest of a strip has to come before turning to the next one. The page is what scrolls, not
      // the viewport, because the track already owns the viewport's vertical axis. The rail is
      // outside all of that, and keeps turning pages whatever the strips beside it are doing.
      const delta = pagingDelta({ x: wheel.axisDelta[0], y: wheel.axisDelta[1] }, event.shiftKey);
      if (
        !onTrack &&
        !event.shiftKey &&
        !inRail(target) &&
        pageScrolls(currentScroller(pagerRef.current.viewportNode), delta)
      ) {
        // The browser is about to scroll this, so none of it is travel towards a page turn: the
        // page at the end of the strips has to be asked for by a movement of its own.
        pageWheelRef.current = INITIAL_PAGE_WHEEL_STATE;
        wheelGestureTracker.touch();
        return;
      }
      event.preventDefault();
      wheelGestureTracker.touch();
      const { state, page } = reducePageWheel(pageWheelRef.current, {
        delta,
        now: performance.now(),
        momentum: wheel.isMomentum,
      });
      pageWheelRef.current = state;
      if (page === 1) {
        pagerRef.current.nextPage();
      } else if (page === -1) {
        pagerRef.current.previousPage();
      }
    };

    // A finger is the same travel by another road, so it goes through the same accumulator: the
    // thresholds, the quiet time and the cooldown are the pager's, not the wheel's.
    const handleTouchStart = (event: TouchEvent) => {
      const { target } = event;
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (
        touch === undefined ||
        (target instanceof Element &&
          target.closest('[data-wheel="level"], [data-swipe="none"]') !== null)
      ) {
        // A fader owns the finger that lands on it, a surface marked `data-swipe="none"` is one
        // a gesture may not begin on, and a second finger is not a page turn.
        touchRef.current = null;
        return;
      }
      // The finger starts counting from nothing; a page turn just before it still has to land.
      pageWheelRef.current = { ...pageWheelRef.current, accumulated: 0, direction: 0 };
      touchRef.current = { lastY: touch.clientY, turned: false };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const drag = touchRef.current;
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (drag === null || touch === undefined) {
        return;
      }
      // A finger moving up asks for the next page, the way a wheel turning down does.
      const delta = drag.lastY - touch.clientY;
      drag.lastY = touch.clientY;
      if (
        !inRail(event.target) &&
        pageScrolls(currentScroller(pagerRef.current.viewportNode), delta)
      ) {
        // The browser is panning the strips, so none of this is travel towards a page turn.
        pageWheelRef.current = INITIAL_PAGE_WHEEL_STATE;
        return;
      }
      const { state, page } = reducePageWheel(pageWheelRef.current, {
        delta,
        now: performance.now(),
      });
      pageWheelRef.current = state;
      if (page === 0) {
        return;
      }
      drag.turned = true;
      if (page === 1) {
        pagerRef.current.nextPage();
      } else {
        pagerRef.current.previousPage();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (touchRef.current?.turned === true) {
        // The gesture meant the page. It must not also press what it came to rest on: the page
        // keys and the ON button are both a finger's width from somewhere it is safe to drag.
        event.preventDefault();
      }
      touchRef.current = null;
    };

    // The wheel arrives through wheel-gestures rather than straight off the element: it is what
    // tells a finger still on the pad apart from the operating system coasting afterwards, which
    // no threshold can do, and it settles the units and the axis on the way past. It is asked not
    // to prevent anything itself — whether this travel belongs to the page is decided below.
    const gestures = WheelGestures({ preventWheelAction: false, reverseSign: false });
    gestures.on('wheel', handleWheel);
    gestures.observe(deckNode);
    deckNode.addEventListener('touchstart', handleTouchStart, { passive: true });
    deckNode.addEventListener('touchmove', handleTouchMove, { passive: true });
    deckNode.addEventListener('touchend', handleTouchEnd);
    deckNode.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      gestures.off('wheel', handleWheel);
      gestures.disconnect();
      deckNode.removeEventListener('touchstart', handleTouchStart);
      deckNode.removeEventListener('touchmove', handleTouchMove);
      deckNode.removeEventListener('touchend', handleTouchEnd);
      deckNode.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [deckNode]);

  return (
    <main
      className="mixer-shell"
      data-theme="dark"
      data-wake-lock={wakeLockStatus}
      style={LAYOUT_VARIABLES}
    >
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
        <div
          className="mixer-deck"
          ref={setDeckNode}
          style={{ '--strip-width': `${fit.stripWidth}px` } as CSSProperties}
        >
          <div className="mixer-bays" ref={attachViewport} data-view-id={activeView?.id}>
            <StripPages
              pages={pages}
              fits={fit.pages}
              chrome={chrome}
              pageIndex={pager.pageIndex}
            />
          </div>
          {/*
           * Full screen lives at the foot of the rail, the size of a page key: the header row is
           * a line of small type meant for a mouse, and this is reached with a thumb. It changes
           * nothing but the browser's own chrome, so it does not breach what the rail is for.
           */}
          <PageRail
            pageIndex={pager.pageIndex}
            pageCount={pageCount}
            onPrevious={previousPage}
            onNext={nextPage}
            onGoTo={pager.goTo}
            fullscreen={fullscreen}
          />
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
