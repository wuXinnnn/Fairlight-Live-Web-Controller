import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Full screen is worth a button on a desk reached by finger: it buys back the address bar and the
 * tab strip, which is a channel strip's worth of height, and it takes away the browser chrome a
 * thumb can hit by accident. Where the browser has no element full screen — iPhone Safari — the
 * button is not rendered at all rather than rendered and inert.
 */
export interface FullscreenState {
  supported: boolean;
  active: boolean;
  toggle(): void;
}

export function useFullscreen(doc: Document = document): FullscreenState {
  // No webkit-prefixed fallback: the prefixed API on iPhone is for video elements only, and
  // pretending otherwise would put a button on screen that does nothing.
  const supported =
    doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === 'function';
  // `Boolean`, not `!== null`: an engine without the API leaves this undefined.
  const [active, setActive] = useState(() => Boolean(doc.fullscreenElement));
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!supported) {
      return;
    }
    const handleChange = () => {
      setActive(Boolean(doc.fullscreenElement));
    };
    doc.addEventListener('fullscreenchange', handleChange);
    return () => {
      doc.removeEventListener('fullscreenchange', handleChange);
    };
  }, [doc, supported]);

  const toggle = useCallback(() => {
    if (!supported) {
      return;
    }
    const change =
      doc.fullscreenElement !== null && doc.fullscreenElement !== undefined
        ? doc.exitFullscreen()
        : doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Wrapped, because an older engine returns nothing from either call.
    void Promise.resolve(change).catch((error: unknown) => {
      if (warnedRef.current) {
        return;
      }
      warnedRef.current = true;
      // A refusal leaves the desk exactly as it was. It is never worth a dialog mid-show.
      console.warn('Unable to change the full screen state.', error);
    });
  }, [doc, supported]);

  return useMemo(() => ({ supported, active, toggle }), [supported, active, toggle]);
}
