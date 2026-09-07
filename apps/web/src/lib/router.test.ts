import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, routeFromPath, setNavigationGuard, useRoute } from './router.js';

describe('router', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    setNavigationGuard(null);
    vi.restoreAllMocks();
  });

  it('maps paths to routes and falls back to the mixer', () => {
    expect(routeFromPath('/')).toBe('mixer');
    expect(routeFromPath('/views')).toBe('views');
    expect(routeFromPath('/views/')).toBe('views');
    expect(routeFromPath('/unknown')).toBe('mixer');
  });

  it('pushes history entries and follows popstate', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe('mixer');

    act(() => navigate('views'));
    expect(window.location.pathname).toBe('/views');
    expect(result.current).toBe('views');

    act(() => navigate('views'));
    expect(result.current).toBe('views');

    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toBe('mixer');

    act(() => navigate('views', 'replace'));
    expect(window.location.pathname).toBe('/views');
    expect(result.current).toBe('views');
  });

  it('reads the URL afresh when nothing is subscribed', () => {
    window.history.replaceState(null, '', '/views');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe('views');
  });

  it('lets an allowing guard through and skips the guard for the current route', () => {
    const guard = vi.fn(() => true);
    setNavigationGuard(guard);
    const { result } = renderHook(() => useRoute());
    act(() => navigate('mixer'));
    expect(guard).not.toHaveBeenCalled();
    act(() => navigate('views'));
    expect(guard).toHaveBeenCalledWith('views');
    expect(result.current).toBe('views');
    expect(window.location.pathname).toBe('/views');
  });

  it('leaves history untouched and does not notify when the guard rejects navigate', () => {
    window.history.replaceState(null, '', '/views');
    const guard = vi.fn(() => false);
    setNavigationGuard(guard);
    const listener = vi.fn();
    const { result } = renderHook(() => {
      const route = useRoute();
      listener(route);
      return route;
    });
    listener.mockClear();
    act(() => navigate('mixer'));
    expect(guard).toHaveBeenCalledWith('mixer');
    expect(window.location.pathname).toBe('/views');
    expect(result.current).toBe('views');
    expect(listener).not.toHaveBeenCalled();
  });

  it('undoes a rejected browser back with history.forward and keeps the route', () => {
    window.history.replaceState(null, '', '/views');
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const guard = vi.fn(() => false);
    setNavigationGuard(guard);
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe('views');

    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(guard).toHaveBeenCalledWith('mixer');
    expect(forward).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('views');

    // The forward() traversal lands on /views again: same as the cache, so it only notifies.
    act(() => {
      window.history.pushState(null, '', '/views');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('views');
  });

  it('stamps history entries with an index and undoes a rejected traversal in its direction', () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const { result } = renderHook(() => useRoute());
    expect(window.history.state).toEqual({ routeIndex: 0 });
    act(() => navigate('views'));
    expect(window.history.state).toEqual({ routeIndex: 1 });
    setNavigationGuard(() => false);

    // Forward to a later entry: undone by going one step back.
    act(() => {
      window.history.pushState({ routeIndex: 2 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(result.current).toBe('views');

    // Back to an earlier entry: undone by going one step forward.
    act(() => {
      window.history.pushState({ routeIndex: 0 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(go).toHaveBeenLastCalledWith(1);
    expect(result.current).toBe('views');
    expect(forward).not.toHaveBeenCalled();

    // Two steps back, e.g. a history menu jump.
    act(() => {
      window.history.pushState({ routeIndex: -1 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(go).toHaveBeenLastCalledWith(2);
  });

  it('keeps the index in step with allowed traversals and replace navigations', () => {
    renderHook(() => useRoute());
    act(() => navigate('views'));
    act(() => {
      window.history.pushState({ routeIndex: 0 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => navigate('views', 'replace'));
    expect(window.history.state).toEqual({ routeIndex: 0 });
    act(() => navigate('mixer'));
    expect(window.history.state).toEqual({ routeIndex: 1 });
  });

  it('updates the cached route when the guard allows a popstate', () => {
    window.history.replaceState(null, '', '/views');
    const guard = vi.fn(() => true);
    setNavigationGuard(guard);
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(guard).toHaveBeenCalledWith('mixer');
    expect(result.current).toBe('mixer');
  });

  it('restores the default behaviour once the guard is removed', () => {
    window.history.replaceState(null, '', '/views');
    setNavigationGuard(() => false);
    const { result } = renderHook(() => useRoute());
    act(() => navigate('mixer'));
    expect(result.current).toBe('views');
    setNavigationGuard(null);
    act(() => navigate('mixer'));
    expect(result.current).toBe('mixer');
    expect(window.location.pathname).toBe('/');
  });
});
