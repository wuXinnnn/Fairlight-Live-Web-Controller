import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { navigate, routeFromPath, useRoute } from './router.js';

describe('router', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
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
});
