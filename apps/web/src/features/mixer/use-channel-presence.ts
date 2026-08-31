import { useEffect, useRef, useState } from 'react';
import type { ChannelState } from '@flwc/shared';

export const CHANNEL_EXIT_MS = 180;

export interface PresenceChannel {
  channel: ChannelState;
  exiting: boolean;
}

export function useChannelPresence(channels: ChannelState[]): PresenceChannel[] {
  const [rendered, setRendered] = useState<PresenceChannel[]>(() =>
    channels.map((channel) => ({ channel, exiting: false })),
  );
  const latestIdsRef = useRef(new Set(channels.map((channel) => channel.id)));
  latestIdsRef.current = new Set(channels.map((channel) => channel.id));

  useEffect(() => {
    const incomingIds = new Set(channels.map((channel) => channel.id));
    setRendered((current) => {
      const next = channels.map((channel) => ({ channel, exiting: false }));
      const removed = current
        .filter((item) => !incomingIds.has(item.channel.id))
        .map((item) => ({ ...item, exiting: true }));
      return [...next, ...removed];
    });

    const timeout = window.setTimeout(() => {
      setRendered((current) =>
        current.filter((item) => !item.exiting || latestIdsRef.current.has(item.channel.id)),
      );
    }, CHANNEL_EXIT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [channels]);

  return rendered;
}
