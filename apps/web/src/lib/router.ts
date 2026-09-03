import { useSyncExternalStore } from 'react';

export type Route = 'mixer' | 'views';

export const ROUTE_PATHS: Record<Route, string> = {
  mixer: '/',
  views: '/views',
};

/** Maps a pathname to an app route; anything unknown falls back to the mixer. */
export function routeFromPath(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === ROUTE_PATHS.views ? 'views' : 'mixer';
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Pushes a history entry for the route. `pushState` never fires popstate, so listeners are notified here. */
export function navigate(route: Route, mode: 'push' | 'replace' = 'push'): void {
  if (routeFromPath(window.location.pathname) === route) {
    return;
  }
  const path = ROUTE_PATHS[route];
  if (mode === 'replace') {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function getSnapshot(): Route {
  return routeFromPath(window.location.pathname);
}

function getServerSnapshot(): Route {
  return 'mixer';
}

/** Current route, kept in sync with browser back and forward navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
