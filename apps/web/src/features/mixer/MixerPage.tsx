import { CHANNEL_KINDS, type ChannelKind } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import type { ControlClient } from '../../lib/socket.js';
import { mixerStore } from '../../store/mixer-store.js';
import { LoudnessPanel } from '../loudness/LoudnessPanel.js';
import { channelTypeColor } from './channel-colors.js';
import { ChannelStrip } from './ChannelStrip.js';
import { ControlLock } from './ControlLock.js';
import { TypeRowToggle } from './TypeRowToggle.js';
import { useChannelPresence } from './use-channel-presence.js';
import { useControlLockPreference } from './use-control-lock-preference.js';
import { useTypeRowsPreference } from './use-type-row-preference.js';

const SECTION_LABELS: Record<ChannelKind, string> = {
  channel: 'INPUTS',
  main: 'MAIN',
  sub: 'SUB',
  aux: 'AUX',
  mixm: 'MIX MINUS',
  mtx: 'MATRIX',
};

interface MixerPageProps {
  controlClient: ControlClient;
  onOpenSettings(): void;
}

export function MixerPage({ controlClient, onOpenSettings }: MixerPageProps) {
  const channels = useStore(
    mixerStore,
    useShallow((state) =>
      state.channelOrder.map((id) => state.channels[id]).filter((channel) => channel !== undefined),
    ),
  );
  const renderedChannels = useChannelPresence(channels);
  const [typeRows, toggleTypeRows] = useTypeRowsPreference();
  const [lockMode, setLockMode] = useControlLockPreference();

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
          <TypeRowToggle enabled={typeRows} onToggle={toggleTypeRows} />
          <ControlLock mode={lockMode} onChange={setLockMode} />
        </div>
        <LoudnessPanel controlClient={controlClient} />
      </header>

      {renderedChannels.length === 0 ? (
        <section className="empty-console" aria-live="polite">
          <span className="empty-console__pulse" aria-hidden="true" />
          <p>WAITING FOR MIXER SNAPSHOT</p>
        </section>
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
