import { beforeEach, describe, expect, it } from 'vitest';
import { FakeViewsClient } from '../../tests/fake-views-client.js';
import {
  ACTIVE_VIEW_STORAGE_KEY,
  clearViewError,
  createView,
  deleteView,
  loadViews,
  resetViewStore,
  setActiveView,
  updateView,
  viewStore,
} from './view-store.js';

const view = {
  id: 'foh',
  name: 'FOH',
  channels: [{ channelId: 'channel/1', lastKnownName: 'BASS' }],
};

describe('viewStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetViewStore();
  });

  it('loads views and restores only a valid active id', async () => {
    const client = new FakeViewsClient([view]);
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view.id);
    await loadViews(client);
    expect(viewStore.getState()).toMatchObject({
      views: [view],
      activeViewId: 'foh',
      loading: false,
    });

    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, 'missing');
    await loadViews(client);
    expect(viewStore.getState().activeViewId).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY)).toBeNull();
  });

  it('sets and persists valid active views', async () => {
    await loadViews(new FakeViewsClient([view]));
    setActiveView('foh');
    expect(viewStore.getState().activeViewId).toBe('foh');
    expect(window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY)).toBe('foh');
    setActiveView('unknown');
    expect(viewStore.getState().activeViewId).toBeNull();
  });

  it('creates, updates, and deletes views while preserving order', async () => {
    const client = new FakeViewsClient([view]);
    await loadViews(client);
    const created = await createView(client, { name: 'Broadcast', channels: [] });
    expect(created?.name).toBe('Broadcast');
    expect(viewStore.getState().views.map((candidate) => candidate.name)).toEqual([
      'FOH',
      'Broadcast',
    ]);

    const updated = await updateView(client, 'foh', {
      name: 'Front of House',
      channels: [{ channelId: 'main/1', lastKnownName: 'Main', color: 'red' }],
    });
    expect(updated?.name).toBe('Front of House');
    setActiveView('foh');
    await expect(deleteView(client, 'foh')).resolves.toBe(true);
    expect(viewStore.getState().activeViewId).toBeNull();
    expect(viewStore.getState().views.map((candidate) => candidate.name)).toEqual(['Broadcast']);
  });

  it('keeps current data and exposes request failures', async () => {
    const client = new FakeViewsClient([view]);
    await loadViews(client);
    client.error = new Error('Service unavailable');
    await expect(createView(client, { name: 'Failed', channels: [] })).resolves.toBeNull();
    await expect(updateView(client, 'foh', { name: 'Failed', channels: [] })).resolves.toBeNull();
    await expect(deleteView(client, 'foh')).resolves.toBe(false);
    expect(viewStore.getState().views).toEqual([view]);
    expect(viewStore.getState().error).toBe('Service unavailable');
    clearViewError();
    expect(viewStore.getState().error).toBeNull();
  });

  it('reports list failures without leaving loading enabled', async () => {
    const client = new FakeViewsClient();
    client.error = new Error('Offline');
    await loadViews(client);
    expect(viewStore.getState()).toMatchObject({ loading: false, error: 'Offline' });
  });
});
