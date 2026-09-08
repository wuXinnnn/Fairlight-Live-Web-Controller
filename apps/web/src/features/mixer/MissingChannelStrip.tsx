import type { ChannelKind, ViewChannelRef, ViewGroup } from '@flwc/shared';
import type { CSSProperties } from 'react';
import { channelAccent } from './channel-colors.js';

interface MissingChannelStripProps {
  reference: ViewChannelRef;
  index: number;
  className?: string;
  /** The group the reference belongs to, so a colour of `'group'` still resolves. */
  group?: ViewGroup;
  /** Kind of the group's first present member. */
  groupLeadKind?: ChannelKind;
}

export function MissingChannelStrip({
  reference,
  index,
  className,
  group,
  groupLeadKind,
}: MissingChannelStripProps) {
  return (
    <article
      className={`channel-strip missing-channel-strip${className === undefined ? '' : ` ${className}`}`}
      aria-label={`${reference.name} missing channel`}
      style={
        {
          '--strip-index': index,
          '--channel-accent': channelAccent(reference.kind, reference.color, group, groupLeadKind),
        } as CSSProperties
      }
    >
      <header className="channel-strip__header">
        <span className="channel-strip__signal" aria-hidden="true" />
        <h3 title={reference.name}>{reference.name}</h3>
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
