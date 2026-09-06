import type { ConnectionStatus } from '@flwc/shared';

export type MixerEmptyState =
  | { kind: 'socket-offline' }
  | { kind: 'ember-offline'; status: ConnectionStatus; lastError: string | null }
  | { kind: 'no-channels' }
  | { kind: 'empty-view' }
  | { kind: 'waiting' };

export interface MixerEmptyStateInput {
  socketConnected: boolean;
  emberStatus: ConnectionStatus;
  emberLastError: string | null;
  channelInventoryLoaded: boolean;
  /** Strips the page would render in All Channels mode (cached inventory included). */
  channelCount: number;
  /** Number of references in the active view, or null in All Channels mode. */
  viewChannelCount: number | null;
}

/**
 * Decides which empty state the mixer shows, or null when strips should render. Once an
 * inventory has loaded it keeps rendering through a status-only reconnect: the controls are
 * disabled by `controlsAvailable` instead of the strips disappearing.
 */
export function resolveMixerEmptyState(input: MixerEmptyStateInput): MixerEmptyState | null {
  const {
    socketConnected,
    emberStatus,
    emberLastError,
    channelInventoryLoaded,
    channelCount,
    viewChannelCount,
  } = input;
  if (channelInventoryLoaded && viewChannelCount === 0) {
    return { kind: 'empty-view' };
  }
  if (channelInventoryLoaded && (viewChannelCount !== null || channelCount > 0)) {
    return null;
  }
  if (!socketConnected) {
    return { kind: 'socket-offline' };
  }
  if (emberStatus !== 'connected') {
    return { kind: 'ember-offline', status: emberStatus, lastError: emberLastError };
  }
  if (channelInventoryLoaded) {
    return { kind: 'no-channels' };
  }
  return { kind: 'waiting' };
}

export function emptyStateTitle(state: MixerEmptyState): string {
  switch (state.kind) {
    case 'socket-offline':
      return 'BACKEND OFFLINE';
    case 'ember-offline':
      return 'MIXER NOT CONNECTED';
    case 'no-channels':
      return 'NO CHANNELS ON THE MIXER';
    case 'empty-view':
      return 'THIS VIEW HAS NO CHANNELS';
    case 'waiting':
      return 'WAITING FOR MIXER SNAPSHOT';
  }
}

export function emptyStateDetail(state: MixerEmptyState): string | null {
  switch (state.kind) {
    case 'socket-offline':
      return 'The control server is unreachable. Check that it is running, then reload this page.';
    case 'ember-offline':
      return `EMBER ${state.status.toUpperCase()}`;
    case 'no-channels':
      return 'The connected device exposes no recognizable channels.';
    default:
      return null;
  }
}
