import { CHANNEL_KINDS, type ChannelKind, type ViewChannelRef } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { channelColor } from './channel-colors.js';

interface MissingChannelStripProps {
  reference: ViewChannelRef;
  index: number;
}

function kindFromChannelId(channelId: string): ChannelKind {
  const prefix = channelId.split('/')[0];
  return CHANNEL_KINDS.find((kind) => kind === prefix) ?? 'channel';
}

export function MissingChannelStrip({ reference, index }: MissingChannelStripProps) {
  const kind = kindFromChannelId(reference.channelId);
  return (
    <article
      className="channel-strip missing-channel-strip"
      aria-label={`${reference.lastKnownName} missing channel`}
      style={
        {
          '--strip-index': index,
          '--channel-accent': channelColor(kind, reference.color),
        } as CSSProperties
      }
    >
      <header className="channel-strip__header">
        <span className="channel-strip__signal" aria-hidden="true" />
        <h3 title={reference.lastKnownName}>{reference.lastKnownName}</h3>
      </header>
      <div className="missing-channel-strip__body">
        <span aria-hidden="true">×</span>
        <strong>MISSING</strong>
        <small>CHANNEL REFERENCE UNAVAILABLE</small>
      </div>
      <div className="missing-channel-strip__trace" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </article>
  );
}
