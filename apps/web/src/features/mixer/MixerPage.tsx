import { CHANNEL_KINDS, type ChannelKind } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ConnectionStatus } from '../../components/ConnectionStatus.js';
import type { ControlClient } from '../../lib/socket.js';
import { mixerStore } from '../../store/mixer-store.js';
import { LoudnessPanel } from '../loudness/LoudnessPanel.js';
import { ChannelStrip } from './ChannelStrip.js';
import { TypeRowToggle } from './TypeRowToggle.js';
import { useChannelPresence } from './use-channel-presence.js';
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
}

export function MixerPage({ controlClient }: MixerPageProps) {
  const channels = useStore(
    mixerStore,
    useShallow((state) =>
      state.channelOrder.map((id) => state.channels[id]).filter((channel) => channel !== undefined),
    ),
  );
  const renderedChannels = useChannelPresence(channels);
  const [typeRows, toggleTypeRows] = useTypeRowsPreference();

  return (
    <main className="mixer-shell" data-theme="dark">
      <header className="console-header">
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE</span>
          <h1>CONTROL DESK</h1>
        </div>
        <ConnectionStatus />
        <TypeRowToggle enabled={typeRows} onToggle={toggleTypeRows} />
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
            if (group.length === 0) {
              return null;
            }
            return (
              <section className="mixer-section" key={kind} aria-labelledby={`section-${kind}`}>
                <header className="mixer-section__header">
                  <h2 id={`section-${kind}`}>{SECTION_LABELS[kind]}</h2>
                  <span>
                    {group
                      .filter((item) => !item.exiting)
                      .length.toString()
                      .padStart(2, '0')}
                  </span>
                </header>
                <div className="channel-bay">
                  {group.map((item, index) => (
                    <ChannelStrip
                      key={item.channel.id}
                      item={item}
                      controlClient={controlClient}
                      style={{ '--strip-index': index } as CSSProperties}
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
