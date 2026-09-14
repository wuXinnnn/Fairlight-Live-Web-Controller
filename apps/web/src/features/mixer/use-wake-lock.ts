import { useCallback, useEffect, useRef, useState } from 'react';
import { createWakeMediaController, type WakeMediaController } from '../../lib/wake-media.js';

/**
 * A mixing desk that goes dark halfway through a show is unusable, and the tablet this runs on
 * has whatever screen timeout the venue left it with. Two roads lead to a lit screen:
 *
 *  - the Screen Wake Lock API, which the browser only exposes in a secure context. Over plain
 *    http on a local network — which is how the tablet reaches this server — `navigator.wakeLock`
 *    is simply not there;
 *  - failing that, a muted video on a loop covering the viewport, which Chrome for Android
 *    keeps the screen on for as long as it is playing and enough of it is visible.
 *
 * Both degrade in silence. Nothing is ever shown on screen about either one, because a desk that
 * interrupts an operator to talk about its own battery is worse than a dark screen.
 */
export type WakeLockStatus = 'unsupported' | 'idle' | 'active' | 'denied';

/** The one method this hook calls on a sentinel, plus the event that says the system took it. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnvironment {
  wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } | undefined;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  media: WakeMediaController;
}

/** What the hook is doing about it, once there is anything it can do. */
type HeldStatus = Extract<WakeLockStatus, 'idle' | 'active' | 'denied'>;

/** Which failure has already been reported. Each one is worth exactly one line in the console. */
type WarnKey = 'acquire' | 'play';

function createWakeLockEnvironment(): WakeLockEnvironment {
  const navigatorWithWakeLock = navigator as Navigator & {
    wakeLock?: WakeLockEnvironment['wakeLock'];
  };
  return {
    wakeLock: navigatorWithWakeLock.wakeLock,
    document,
    media: createWakeMediaController(document),
  };
}

/** Neither road is open: no lock to ask for, and a document that could not play a video. */
function isUnsupported(environment: WakeLockEnvironment): boolean {
  return environment.wakeLock === undefined && !environment.media.supported;
}

/** Letting go on the way out is best effort: there is no one left to tell if it fails. */
function releaseQuietly(sentinel: WakeLockSentinelLike): void {
  void Promise.resolve(sentinel.release()).catch(() => {
    // The system may have taken it back a moment earlier, which is the outcome we wanted anyway.
  });
}

export function useWakeLock(enabled: boolean, env?: WakeLockEnvironment): WakeLockStatus {
  // Lazily built and then kept: building one has no side effects, so StrictMode throwing the
  // first away costs nothing, and the hook order stays the same whether or not `env` was given.
  const [defaultEnvironment] = useState(createWakeLockEnvironment);
  const environment = env ?? defaultEnvironment;

  const [held, setHeld] = useState<HeldStatus>('idle');
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  // A ref outlives the unmount and remount StrictMode simulates, which is what makes once mean
  // once rather than twice.
  const warnedRef = useRef<Record<WarnKey, boolean>>({ acquire: false, play: false });

  const warnOnce = useCallback((key: WarnKey, message: string, error: unknown) => {
    if (warnedRef.current[key]) {
      return;
    }
    warnedRef.current[key] = true;
    // Silent on screen is not silent in the console: the same rule the preference hooks follow.
    console.warn(message, error);
  }, []);

  useEffect(() => {
    const { wakeLock, document: doc, media } = environment;

    // Both of these are read straight off the arguments on the way out instead, so that this
    // effect never writes state synchronously and sets off a second render for nothing.
    if (!enabled || isUnsupported(environment)) {
      return;
    }

    // Cleanup flips this, so a promise that lands afterwards releases what it was given instead
    // of writing state for a component that is gone.
    let cancelled = false;
    let pending = false;

    if (wakeLock !== undefined) {
      const requestLock = () => {
        if (cancelled || pending || sentinelRef.current !== null) {
          return;
        }
        if (doc.visibilityState !== 'visible') {
          return;
        }
        pending = true;
        void wakeLock.request('screen').then(
          (sentinel) => {
            pending = false;
            if (cancelled) {
              releaseQuietly(sentinel);
              return;
            }
            sentinelRef.current = sentinel;
            sentinel.addEventListener('release', () => {
              // The system took it back: the tab went away, or a battery saver said enough.
              // Asking again is the next visibilitychange's job.
              if (sentinelRef.current === sentinel) {
                sentinelRef.current = null;
              }
              if (!cancelled) {
                setHeld('idle');
              }
            });
            setHeld('active');
          },
          (error: unknown) => {
            pending = false;
            if (cancelled) {
              return;
            }
            // A refusal is final for this attempt only. A tablet coming back from its lock
            // screen routinely grants what it had just refused, so the next time it becomes
            // visible this asks again.
            warnOnce('acquire', 'Unable to hold the screen awake.', error);
            setHeld('denied');
          },
        );
      };

      const handleVisibility = () => {
        if (doc.visibilityState === 'visible') {
          requestLock();
        }
      };

      doc.addEventListener('visibilitychange', handleVisibility);
      requestLock();
      return () => {
        cancelled = true;
        doc.removeEventListener('visibilitychange', handleVisibility);
        const sentinel = sentinelRef.current;
        sentinelRef.current = null;
        if (sentinel !== null) {
          releaseQuietly(sentinel);
        }
        // Nothing is held any more, and a refusal from last time must not outlive it.
        setHeld('idle');
      };
    }

    // The fallback. A muted clip is exempt from the autoplay policy, so it does not wait to be
    // touched: when the desk comes back after the computer it is plugged into was switched on,
    // the tablet has lit up by itself and there is nobody standing over it.
    media.attach();

    const startPlayback = (fromGesture: boolean) => {
      if (cancelled || media.playing || doc.visibilityState !== 'visible') {
        return;
      }
      if (fromGesture) {
        // Said ahead of the promise on purpose: inside a real gesture playing is the expected
        // outcome, and announcing it here keeps the update in React's event batch rather than
        // in a microtask after the surrounding act() has closed.
        setHeld('active');
      }
      void media.start().then(
        () => {
          // `playing` is false if a pause or a teardown overtook this start while it was in
          // flight — announcing `active` here anyway would describe a clip that has stopped.
          if (!cancelled && !fromGesture && media.playing) {
            setHeld('active');
          }
        },
        (error: unknown) => {
          if (cancelled) {
            return;
          }
          warnOnce('play', 'Unable to play the wake-lock video.', error);
          setHeld('denied');
        },
      );
    };

    const startFromGesture = () => {
      startPlayback(true);
    };

    const handleVisibility = () => {
      if (doc.visibilityState === 'visible') {
        // Back in view, so try again unprompted — the tablet may have woken on its own.
        startPlayback(false);
        return;
      }
      media.stop();
      if (!cancelled) {
        setHeld('idle');
      }
    };

    // Kept as the fallback for an engine that refuses to start a clip nobody asked for.
    doc.addEventListener('pointerdown', startFromGesture, { passive: true });
    doc.addEventListener('keydown', startFromGesture, { passive: true });
    doc.addEventListener('visibilitychange', handleVisibility);
    startPlayback(false);
    return () => {
      cancelled = true;
      doc.removeEventListener('pointerdown', startFromGesture);
      doc.removeEventListener('keydown', startFromGesture);
      doc.removeEventListener('visibilitychange', handleVisibility);
      media.stop();
      media.destroy();
      setHeld('idle');
    };
  }, [enabled, environment, warnOnce]);

  if (isUnsupported(environment)) {
    return 'unsupported';
  }
  return enabled ? held : 'idle';
}
