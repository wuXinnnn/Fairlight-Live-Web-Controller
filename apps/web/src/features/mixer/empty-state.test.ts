import { describe, expect, it } from 'vitest';
import {
  emptyStateDetail,
  emptyStateTitle,
  resolveMixerEmptyState,
  type MixerEmptyStateInput,
} from './empty-state.js';

const base: MixerEmptyStateInput = {
  socketConnected: true,
  emberStatus: 'connected',
  emberLastError: null,
  channelInventoryLoaded: false,
  channelCount: 0,
  viewChannelCount: null,
};

describe('resolveMixerEmptyState', () => {
  it('reports the backend socket as offline before anything else', () => {
    expect(
      resolveMixerEmptyState({ ...base, socketConnected: false, emberStatus: 'disconnected' }),
    ).toEqual({ kind: 'socket-offline' });
    expect(
      resolveMixerEmptyState({
        ...base,
        socketConnected: false,
        channelInventoryLoaded: true,
        channelCount: 0,
      }),
    ).toEqual({ kind: 'socket-offline' });
  });

  it('reports the mixer as not connected for every non-connected status', () => {
    for (const status of ['disconnected', 'connecting', 'reconnecting'] as const) {
      expect(resolveMixerEmptyState({ ...base, emberStatus: status })).toEqual({
        kind: 'ember-offline',
        status,
        lastError: null,
      });
    }
    expect(
      resolveMixerEmptyState({
        ...base,
        emberStatus: 'reconnecting',
        emberLastError: 'Timeout after 5000ms: connect',
      }),
    ).toEqual({
      kind: 'ember-offline',
      status: 'reconnecting',
      lastError: 'Timeout after 5000ms: connect',
    });
  });

  it('reports an empty tree only after a connected inventory arrived', () => {
    expect(resolveMixerEmptyState({ ...base, channelInventoryLoaded: true })).toEqual({
      kind: 'no-channels',
    });
    expect(resolveMixerEmptyState(base)).toEqual({ kind: 'waiting' });
  });

  it('keeps rendering cached strips through a reconnect once loaded', () => {
    expect(
      resolveMixerEmptyState({
        ...base,
        channelInventoryLoaded: true,
        channelCount: 3,
        emberStatus: 'reconnecting',
        emberLastError: 'Timeout after 5000ms: connect',
      }),
    ).toBeNull();
    expect(
      resolveMixerEmptyState({
        ...base,
        channelInventoryLoaded: true,
        channelCount: 3,
        socketConnected: false,
      }),
    ).toBeNull();
    expect(
      resolveMixerEmptyState({
        ...base,
        channelInventoryLoaded: true,
        channelCount: 0,
        viewChannelCount: 2,
        emberStatus: 'reconnecting',
      }),
    ).toBeNull();
  });

  it('keeps the empty view state independent of the connection', () => {
    expect(
      resolveMixerEmptyState({
        ...base,
        channelInventoryLoaded: true,
        channelCount: 3,
        viewChannelCount: 0,
        emberStatus: 'reconnecting',
      }),
    ).toEqual({ kind: 'empty-view' });
    expect(
      resolveMixerEmptyState({ ...base, viewChannelCount: 0, emberStatus: 'connecting' }),
    ).toEqual({ kind: 'ember-offline', status: 'connecting', lastError: null });
  });

  it('provides English copy for every state', () => {
    expect(emptyStateTitle({ kind: 'socket-offline' })).toBe('BACKEND OFFLINE');
    expect(emptyStateDetail({ kind: 'socket-offline' })).toMatch(/control server is unreachable/);
    expect(emptyStateTitle({ kind: 'ember-offline', status: 'connecting', lastError: null })).toBe(
      'MIXER NOT CONNECTED',
    );
    expect(emptyStateDetail({ kind: 'ember-offline', status: 'connecting', lastError: null })).toBe(
      'EMBER CONNECTING',
    );
    expect(emptyStateTitle({ kind: 'no-channels' })).toBe('NO CHANNELS ON THE MIXER');
    expect(emptyStateDetail({ kind: 'no-channels' })).toMatch(/no recognizable channels/);
    expect(emptyStateTitle({ kind: 'empty-view' })).toBe('THIS VIEW HAS NO CHANNELS');
    expect(emptyStateDetail({ kind: 'empty-view' })).toBeNull();
    expect(emptyStateTitle({ kind: 'waiting' })).toBe('WAITING FOR MIXER SNAPSHOT');
    expect(emptyStateDetail({ kind: 'waiting' })).toBeNull();
  });
});
