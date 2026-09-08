import { useSyncExternalStore } from 'react';

export type Route = 'mixer' | 'views';

export const ROUTE_PATHS: Record<Route, string> = {
  mixer: '/',
  views: '/views',
};

/**
 * Decides whether a navigation to `next` may proceed. A guard that returns false is responsible
 * for whatever happens instead (the configuration page opens its discard dialog); the router
 * itself shows no UI.
 */
export type NavigationGuard = (next: Route) => boolean;

/** Maps a pathname to an app route; anything unknown falls back to the mixer. */
export function routeFromPath(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === ROUTE_PATHS.views ? 'views' : 'mixer';
}

const listeners = new Set<() => void>();
let guard: NavigationGuard | null = null;
/** The route the app currently shows: the last one the guard allowed, not the raw URL. */
let currentRoute: Route = routeFromPath(window.location.pathname);
/**
 * Position of the current entry in the session history, stored in `history.state` so a rejected
 * traversal can be undone in the direction it came from (`history.go(current - target)`).
 */
let currentIndex = 0;

function readIndex(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }
  const index = (state as { routeIndex?: unknown }).routeIndex;
  return typeof index === 'number' ? index : null;
}

/** Gives the current entry an index when it has none, e.g. the entry the app was opened on. */
function stampCurrentEntry(): void {
  const index = readIndex(window.history.state);
  if (index === null) {
    currentIndex = 0;
    window.history.replaceState({ routeIndex: 0 }, '');
  } else {
    currentIndex = index;
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Nothing can have been allowed while nobody is subscribed, so the URL is the truth then. */
function syncedRoute(): Route {
  if (listeners.size === 0) {
    currentRoute = routeFromPath(window.location.pathname);
  }
  return currentRoute;
}

/** Installs the single navigation guard, or removes it with null. */
export function setNavigationGuard(next: NavigationGuard | null): void {
  guard = next;
}

/**
 * Pushes a history entry for the route after asking the guard. `pushState` never fires
 * popstate, so listeners are notified here. A rejected navigation changes nothing.
 */
export function navigate(route: Route, mode: 'push' | 'replace' = 'push'): void {
  if (syncedRoute() === route) {
    return;
  }
  if (guard !== null && !guard(route)) {
    return;
  }
  const path = ROUTE_PATHS[route];
  if (mode === 'replace') {
    window.history.replaceState({ routeIndex: currentIndex }, '', path);
  } else {
    currentIndex += 1;
    window.history.pushState({ routeIndex: currentIndex }, '', path);
  }
  currentRoute = route;
  notify();
}

/**
 * Browser back and forward. A rejected entry is undone by travelling back to the current entry
 * (its index tells the direction and distance; an entry without an index can only have come
 * from Back, so `forward()` undoes it). The popstate that traversal fires matches the cache and
 * only notifies.
 */
function onPopState(): void {
  const next = routeFromPath(window.location.pathname);
  const index = readIndex(window.history.state);
  if (next === currentRoute) {
    currentIndex = index ?? currentIndex;
    notify();
    return;
  }
  if (guard !== null && !guard(next)) {
    if (index === null) {
      window.history.forward();
    } else {
      window.history.go(currentIndex - index);
    }
    return;
  }
  currentRoute = next;
  currentIndex = index ?? currentIndex;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    currentRoute = routeFromPath(window.location.pathname);
    stampCurrentEntry();
    window.addEventListener('popstate', onPopState);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('popstate', onPopState);
    }
  };
}

function getSnapshot(): Route {
  return syncedRoute();
}

function getServerSnapshot(): Route {
  return 'mixer';
}

/** Current route, kept in sync with browser back and forward navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
