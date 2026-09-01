import type { ChannelState } from '@flwc/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_EXIT_MS, useChannelPresence } from './use-channel-presence.js';

const channel: ChannelState = {
  id: 'channel/1',
  kind: 'channel',
  name: 'BASS',
  levelDb: -12,
  muted: false,
  meterDb: -30,
};

function Harness({ channels }: { channels: ChannelState[] }) {
  const rendered = useChannelPresence(channels);
  return (
    <div>
      {rendered.map((item) => (
        <span key={item.channel.id}>
          {item.channel.name}:{item.exiting ? 'exit' : 'live'}
        </span>
      ))}
    </div>
  );
}

describe('useChannelPresence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retains removed channels for their exit motion', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness channels={[channel]} />);
    expect(screen.getByText('BASS:live')).toBeInTheDocument();

    rerender(<Harness channels={[]} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText('BASS:exit')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CHANNEL_EXIT_MS);
    });
    expect(screen.queryByText('BASS:exit')).not.toBeInTheDocument();
  });
});
