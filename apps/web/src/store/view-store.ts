import type { View, ViewWriteBody } from '@flwc/shared';
import { createStore } from 'zustand/vanilla';
import type { ViewsClient } from '../lib/views-api.js';

export const ACTIVE_VIEW_STORAGE_KEY = 'flwc.views.activeId.v1';

export interface ViewStoreState {
  views: View[];
  activeViewId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const INITIAL_STATE: ViewStoreState = {
  views: [],
  activeViewId: null,
  loading: false,
  saving: false,
  error: null,
};

export const viewStore = createStore<ViewStoreState>()(() => INITIAL_STATE);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The views request failed.';
}

function storedActiveViewId(): string | null {
  return window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
}

function persistActiveViewId(id: string | null): void {
  if (id === null) {
    window.localStorage.removeItem(ACTIVE_VIEW_STORAGE_KEY);
  } else {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, id);
  }
}

export function resetViewStore(): void {
  viewStore.setState(INITIAL_STATE, true);
}

export async function loadViews(client: ViewsClient): Promise<void> {
  viewStore.setState({ loading: true, error: null });
  try {
    const views = await client.list();
    const storedId = storedActiveViewId();
    const activeViewId =
      storedId !== null && views.some((view) => view.id === storedId) ? storedId : null;
    persistActiveViewId(activeViewId);
    viewStore.setState({ views, activeViewId, loading: false });
  } catch (error) {
    viewStore.setState({ loading: false, error: errorMessage(error) });
  }
}

export function setActiveView(id: string | null): void {
  const validId =
    id !== null && viewStore.getState().views.some((view) => view.id === id) ? id : null;
  persistActiveViewId(validId);
  viewStore.setState({ activeViewId: validId });
}

export async function createView(client: ViewsClient, body: ViewWriteBody): Promise<View | null> {
  viewStore.setState({ saving: true, error: null });
  try {
    const view = await client.create(body);
    viewStore.setState((state) => ({
      views: [...state.views, view],
      saving: false,
    }));
    return view;
  } catch (error) {
    viewStore.setState({ saving: false, error: errorMessage(error) });
    return null;
  }
}

export async function updateView(
  client: ViewsClient,
  id: string,
  body: ViewWriteBody,
): Promise<View | null> {
  viewStore.setState({ saving: true, error: null });
  try {
    const view = await client.update(id, body);
    viewStore.setState((state) => ({
      views: state.views.map((candidate) => (candidate.id === id ? view : candidate)),
      saving: false,
    }));
    return view;
  } catch (error) {
    viewStore.setState({ saving: false, error: errorMessage(error) });
    return null;
  }
}

export async function deleteView(client: ViewsClient, id: string): Promise<boolean> {
  viewStore.setState({ saving: true, error: null });
  try {
    await client.remove(id);
    viewStore.setState((state) => {
      const activeViewId = state.activeViewId === id ? null : state.activeViewId;
      if (activeViewId === null) {
        persistActiveViewId(null);
      }
      return {
        views: state.views.filter((view) => view.id !== id),
        activeViewId,
        saving: false,
      };
    });
    return true;
  } catch (error) {
    viewStore.setState({ saving: false, error: errorMessage(error) });
    return false;
  }
}

export function clearViewError(): void {
  viewStore.setState({ error: null });
}
