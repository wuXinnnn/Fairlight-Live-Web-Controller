import { useEffect, useRef, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import { Fader } from '../../components/Fader.js';
import { Meter } from '../../components/Meter.js';
import { OnButton } from '../../components/OnButton.js';
import type { ControlClient } from '../../lib/socket.js';
import {
  beginLevelInteraction,
  beginOnInteraction,
  controlsAvailable,
  finishLevelInteraction,
  finishOnInteraction,
  mixerStore,
  setLocalLevel,
} from '../../store/mixer-store.js';
import type { PresenceChannel } from './use-channel-presence.js';

const LEVEL_SEND_INTERVAL_MS = 50;

interface ChannelStripProps {
  item: PresenceChannel;
  controlClient: ControlClient;
  style?: CSSProperties;
}

export function ChannelStrip({ item, controlClient, style }: ChannelStripProps) {
  const { channel } = item;
  const liveChannel = useStore(mixerStore, (state) => state.channels[channel.id] ?? channel);
  const controlsEnabled = useStore(mixerStore, controlsAvailable);
  const levelPending = useStore(
    mixerStore,
    (state) => state.pendingLevels[channel.id] !== undefined,
  );
  const onPending = useStore(mixerStore, (state) => state.pendingOns[channel.id] !== undefined);
  const previewTimerRef = useRef<number | undefined>(undefined);
  const previewValueRef = useRef(liveChannel.levelDb);
  const lastSendRef = useRef(0);

  useEffect(
    () => () => {
      window.clearTimeout(previewTimerRef.current);
    },
    [],
  );

  const sendPreview = (levelDb: number) => {
    lastSendRef.current = performance.now();
    void controlClient.setLevel({ id: channel.id, levelDb });
  };

  const handleLevelChange = (levelDb: number) => {
    setLocalLevel(channel.id, levelDb);
    previewValueRef.current = levelDb;
    const remaining = LEVEL_SEND_INTERVAL_MS - (performance.now() - lastSendRef.current);
    if (remaining <= 0) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = undefined;
      sendPreview(levelDb);
    } else if (previewTimerRef.current === undefined) {
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = undefined;
        sendPreview(previewValueRef.current);
      }, remaining);
    }
  };

  const handleLevelCommit = (levelDb: number) => {
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = undefined;
    void controlClient.setLevel({ id: channel.id, levelDb }).then((ack) => {
      finishLevelInteraction(channel.id, ack);
    });
  };

  const handleOnToggle = (on: boolean) => {
    beginOnInteraction(channel.id, on);
    void controlClient.setOn({ id: channel.id, on }).then((ack) => {
      finishOnInteraction(channel.id, ack);
    });
  };

  return (
    <article
      className={`channel-strip ${item.exiting ? 'is-exiting' : 'is-entering'}`}
      style={style}
      data-channel-id={channel.id}
    >
      <header className="channel-strip__header">
        <span className="channel-strip__signal" aria-hidden="true" />
        <h3 title={liveChannel.name}>{liveChannel.name}</h3>
      </header>
      <div className="channel-strip__controls">
        <Meter id={channel.id} label={liveChannel.name} active={controlsEnabled} />
        <Fader
          label={liveChannel.name}
          value={liveChannel.levelDb}
          disabled={!controlsEnabled || item.exiting}
          pending={levelPending}
          onInteractionStart={() => {
            beginLevelInteraction(channel.id);
          }}
          onValueChange={handleLevelChange}
          onCommit={handleLevelCommit}
        />
      </div>
      <OnButton
        label={liveChannel.name}
        on={!liveChannel.muted}
        disabled={!controlsEnabled || item.exiting}
        pending={onPending}
        onToggle={handleOnToggle}
      />
    </article>
  );
}
