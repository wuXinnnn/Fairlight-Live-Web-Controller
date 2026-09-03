import { CHANNEL_KINDS, type ChannelKind } from '@flwc/shared';
import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import type { ControlClient } from '../../lib/socket.js';
import { mixerStore } from '../../store/mixer-store.js';
import { viewStore } from '../../store/view-store.js';
import { LoudnessPanel } from '../loudness/LoudnessPanel.js';
import { channelColor, channelTypeColor } from './channel-colors.js';
import { ChannelStrip } from './ChannelStrip.js';
import { ControlLock } from './ControlLock.js';
import { MissingChannelStrip } from './MissingChannelStrip.js';
import { TypeRowToggle } from './TypeRowToggle.js';
import { useChannelPresence, type PresenceChannel } from './use-channel-presence.js';
import { useControlLockPreference } from './use-control-lock-preference.js';
import { useTypeRowsPreference } from './use-type-row-preference.js';
import {
  resolveViewChannels,
  segmentViewChannels,
  type ResolvedViewChannel,
  type ViewSegment,
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

interface MixerPageProps {
  controlClient: ControlClient;
  onOpenSettings(): void;
}

function segmentAccent(segment: ViewSegment): string {
  const present = segment.entries.find((entry) => entry.channel !== undefined);
  const lead = present ?? segment.entries[0];
  if (lead === undefined) {
    return channelTypeColor('channel');
  }
  return channelColor(lead.channel?.kind ?? lead.reference.kind, lead.reference.color);
}

export function MixerPage({ controlClient, onOpenSettings }: MixerPageProps) {
  const channels = useStore(
    mixerStore,
    useShallow((state) =>
      state.channelOrder.map((id) => state.channels[id]).filter((channel) => channel !== undefined),
    ),
  );
  const channelInventoryLoaded = useStore(mixerStore, (state) => state.channelInventoryLoaded);
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
  const [typeRows, toggleTypeRows] = useTypeRowsPreference();
  const [lockMode, setLockMode] = useControlLockPreference();
  const viewHasGroups = activeView !== null && activeView.groups.length > 0;
  const emptyMessage =
    channelInventoryLoaded && activeView !== null && activeView.channels.length === 0
      ? 'THIS VIEW HAS NO CHANNELS'
      : 'WAITING FOR MIXER SNAPSHOT';

  const renderViewStrip = (entry: ResolvedViewChannel, position: number): ReactNode => {
    const { reference, channel, index } = entry;
    let item: PresenceChannel | undefined;
    if (channel !== undefined) {
      item = renderedById.get(channel.id) ?? { channel, exiting: false };
    } else {
      // Keep the exit animation of the strip that just disappeared from the inventory. It is
      // matched by kind and name, not by the persisted id, which Fairlight may have renumbered.
      item = renderedChannels.find(
        (candidate) =>
          !claimedIds.has(candidate.channel.id) &&
          candidate.channel.kind === reference.kind &&
          candidate.channel.name.trim() === reference.name.trim(),
      );
      if (item !== undefined) {
        claimedIds.add(item.channel.id);
      }
    }
    if (item === undefined) {
      return <MissingChannelStrip key={`ref-${index}`} reference={reference} index={position} />;
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
            '--channel-accent': channelColor(item.channel.kind, reference.color),
          } as CSSProperties
        }
      />
    );
  };

  const renderViewSegment = (segment: ViewSegment, offset: number): ReactNode => {
    const { group, entries } = segment;
    const first = entries[0];
    if (group === undefined || first === undefined) {
      return (
        <Fragment key={`loose-${first?.index ?? offset}`}>
          {offset > 0 && <span className="view-row-break" aria-hidden="true" />}
          {entries.map((entry, position) => renderViewStrip(entry, offset + position))}
        </Fragment>
      );
    }
    const headingId = `view-group-${group.id}-${first.index}`;
    const presentCount = entries.filter((entry) => entry.channel !== undefined).length;
    return (
      <section
        className="mixer-section"
        key={`group-${group.id}-${first.index}`}
        aria-labelledby={headingId}
        data-view-group-id={group.id}
        style={{ '--channel-accent': segmentAccent(segment) } as CSSProperties}
      >
        <div className="channel-group-lead">
          <header className="mixer-section__header">
            <h2 id={headingId}>{group.name}</h2>
            <span>{presentCount.toString().padStart(2, '0')}</span>
          </header>
          {renderViewStrip(first, offset)}
        </div>
        <div className="channel-bay">
          {entries.slice(1).map((entry, position) => renderViewStrip(entry, offset + position + 1))}
        </div>
      </section>
    );
  };

  const renderViewLayout = (): ReactNode => {
    if (activeView === null) {
      return null;
    }
    const segments = segmentViewChannels(activeView, resolvedView);
    let offset = 0;
    return segments.map((segment) => {
      const rendered = renderViewSegment(segment, offset);
      offset += segment.entries.length;
      return rendered;
    });
  };

  return (
    <main className="mixer-shell" data-theme="dark">
      <header className="console-header">
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE</span>
          <h1>CONTROL DESK</h1>
          <button type="button" className="console-brand__action" onClick={onOpenSettings}>
            CONFIGURE VIEWS
          </button>
        </div>
        <ConnectionStatus />
        <div className="console-preferences">
          <ViewSelector />
          {(activeView === null || viewHasGroups) && (
            <TypeRowToggle
              enabled={typeRows}
              onToggle={toggleTypeRows}
              label={
                activeView === null
                  ? 'Start each channel type on a new row'
                  : 'Start each group on a new row'
              }
            />
          )}
          <ControlLock mode={lockMode} onChange={setLockMode} />
        </div>
        <LoudnessPanel controlClient={controlClient} />
      </header>

      {!channelInventoryLoaded ||
      (activeView === null && renderedChannels.length === 0) ||
      (activeView !== null && activeView.channels.length === 0) ? (
        <section className="empty-console" aria-live="polite">
          <span className="empty-console__pulse" aria-hidden="true" />
          <p>{emptyMessage}</p>
        </section>
      ) : activeView !== null ? (
        <div
          className={`mixer-bays is-view-mode ${typeRows && viewHasGroups ? 'is-type-rows' : ''}`}
          data-view-id={activeView.id}
        >
          {renderViewLayout()}
        </div>
      ) : (
        <div className={`mixer-bays ${typeRows ? 'is-type-rows' : ''}`}>
          {CHANNEL_KINDS.map((kind) => {
            const group = renderedChannels.filter(({ channel }) => channel.kind === kind);
            const firstItem = group[0];
            if (firstItem === undefined) {
              return null;
            }
            return (
              <section
                className="mixer-section"
                key={kind}
                aria-labelledby={`section-${kind}`}
                data-channel-kind={kind}
                style={
                  {
                    '--channel-accent': channelTypeColor(kind),
                  } as CSSProperties
                }
              >
                <div className="channel-group-lead">
                  <header className="mixer-section__header">
                    <h2 id={`section-${kind}`}>{SECTION_LABELS[kind]}</h2>
                    <span>
                      {group
                        .filter((item) => !item.exiting)
                        .length.toString()
                        .padStart(2, '0')}
                    </span>
                  </header>
                  <ChannelStrip
                    item={firstItem}
                    controlClient={controlClient}
                    lockMode={lockMode}
                    style={{ '--strip-index': 0 } as CSSProperties}
                  />
                </div>
                <div className="channel-bay">
                  {group.slice(1).map((item, index) => (
                    <ChannelStrip
                      key={item.channel.id}
                      item={item}
                      controlClient={controlClient}
                      lockMode={lockMode}
                      style={{ '--strip-index': index + 1 } as CSSProperties}
                    />
                  ))}
                </div>
              </section>
            );
          })}
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
