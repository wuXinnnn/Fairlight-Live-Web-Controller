import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeMediaController } from '../../lib/wake-media.js';
import { useWakeLock, type WakeLockEnvironment, type WakeLockStatus } from './use-wake-lock.js';

/** A probe rather than renderHook: the status is read the same way the mixer shell exposes it. */
function Probe({ enabled, env }: { enabled: boolean; env: WakeLockEnvironment }) {
  const status = useWakeLock(enabled, env);
  return <div data-testid="status">{status}</div>;
}

const status = (): WakeLockStatus =>
  screen.getByTestId('status').textContent as unknown as WakeLockStatus;

/**
 * The real document with a stubbed `visibilityState`. Writing a stand-in object instead would
 * mean satisfying the overloads on `Document['addEventListener']`, and this way the listeners,
 * the dispatch and the removal are all the ones that will run in a browser.
 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  fireEvent(document, new Event('visibilitychange'));
}

function fakeWakeLock() {
  const releaseListeners: (() => void)[] = [];
  const sentinel = {
    release: vi.fn(() => Promise.resolve()),
    addEventListener: (_type: 'release', listener: () => void) => {
      releaseListeners.push(listener);
    },
  };
  const request = vi.fn(() => Promise.resolve(sentinel));
  return {
    wakeLock: { request },
    sentinel,
    request,
    /** The system taking the lock back, which is what going to the lock screen looks like. */
    takeBack() {
      act(() => {
        for (const listener of releaseListeners) {
          listener();
        }
      });
    },
  };
}

function mediaEnvironment(): WakeLockEnvironment {
  return { wakeLock: undefined, document, media: createWakeMediaController(document) };
}

const video = () => document.querySelector<HTMLVideoElement>('video.wake-media');

/** Waits for the promises a request or a play() call went through. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWakeLock', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  describe('with the native API', () => {
    it('holds a lock, loses it to the system and asks again on the way back', async () => {
      const lock = fakeWakeLock();
      render(<Probe enabled env={{ ...mediaEnvironment(), wakeLock: lock.wakeLock }} />);

      await settle();
      expect(lock.request).toHaveBeenCalledWith('screen');
      expect(status()).toBe('active');

      // The tablet goes to its lock screen: the system takes the sentinel back.
      lock.takeBack();
      expect(status()).toBe('idle');

      act(() => {
        setVisibility('hidden');
      });
      act(() => {
        setVisibility('visible');
      });
      await settle();
      expect(lock.request).toHaveBeenCalledTimes(2);
      expect(status()).toBe('active');
    });

    it('takes a refusal quietly and tries again the next time it is looked at', async () => {
      const lock = fakeWakeLock();
      lock.request.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
      render(<Probe enabled env={{ ...mediaEnvironment(), wakeLock: lock.wakeLock }} />);

      await settle();
      expect(status()).toBe('denied');
      expect(warn).toHaveBeenCalledTimes(1);

      // A tablet routinely grants on the way back what it refused on the way in.
      act(() => {
        setVisibility('visible');
      });
      await settle();
      expect(lock.request).toHaveBeenCalledTimes(2);
      // Still refused, and still only one line about it.
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('lets the lock go when it is no longer wanted', async () => {
      const lock = fakeWakeLock();
      const env = { ...mediaEnvironment(), wakeLock: lock.wakeLock };
      const { rerender } = render(<Probe enabled env={env} />);
      await settle();
      expect(status()).toBe('active');

      rerender(<Probe enabled={false} env={env} />);
      expect(lock.sentinel.release).toHaveBeenCalledTimes(1);
      expect(status()).toBe('idle');
    });
  });

  describe('with the video fallback', () => {
    it('waits for a gesture, gives up the screen when hidden and waits again', async () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
      const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
      const env = mediaEnvironment();
      render(<Probe enabled env={env} />);

      // The element is in the document from the start, but autoplay policy means it cannot
      // play until something is touched.
      expect(video()).not.toBeNull();
      expect(video()?.muted).toBe(true);
      expect(play).not.toHaveBeenCalled();
      expect(status()).toBe('idle');

      fireEvent.pointerDown(document.body);
      expect(play).toHaveBeenCalledTimes(1);
      expect(status()).toBe('active');

      act(() => {
        setVisibility('hidden');
      });
      expect(pause).toHaveBeenCalled();
      expect(status()).toBe('idle');

      // Coming back into view is not a gesture; the next key press is.
      act(() => {
        setVisibility('visible');
      });
      expect(play).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(document.body, { key: 'a' });
      expect(play).toHaveBeenCalledTimes(2);
      expect(status()).toBe('active');
    });

    it('rewinds the clip by hand, because a loop this short is not reliable', () => {
      render(<Probe enabled env={mediaEnvironment()} />);
      const element = video();
      expect(element).not.toBeNull();

      const clip = element as HTMLVideoElement;
      clip.currentTime = 0.6;
      fireEvent.timeUpdate(clip);
      expect(clip.currentTime).toBe(0);

      clip.currentTime = 0.2;
      fireEvent.timeUpdate(clip);
      expect(clip.currentTime).toBe(0.2);
    });

    it('plays again after being hidden while play() was still in flight', async () => {
      let resolvePlay = () => undefined;
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePlay = () => {
              resolve();
            };
          }),
      );
      render(<Probe enabled env={mediaEnvironment()} />);

      fireEvent.pointerDown(document.body);
      expect(play).toHaveBeenCalledTimes(1);

      // The tablet goes to its lock screen before the clip has started. The play that lands
      // afterwards is for a video that has since been paused, and must not be recorded as one
      // that is running — or the next gesture will skip it and the screen will go dark.
      act(() => {
        setVisibility('hidden');
      });
      resolvePlay();
      await settle();
      expect(status()).toBe('idle');

      act(() => {
        setVisibility('visible');
      });
      fireEvent.pointerDown(document.body);
      expect(play).toHaveBeenCalledTimes(2);
      resolvePlay();
      await settle();
      expect(status()).toBe('active');
    });

    it('takes a refused play quietly', async () => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
        new DOMException('gesture required', 'NotAllowedError'),
      );
      render(<Probe enabled env={mediaEnvironment()} />);

      fireEvent.pointerDown(document.body);
      await settle();
      expect(status()).toBe('denied');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('takes the video away with it', () => {
      const env = mediaEnvironment();
      const { rerender } = render(<Probe enabled env={env} />);
      expect(video()).not.toBeNull();

      // Leaving the mixer for the settings page: nothing left to keep awake.
      rerender(<Probe enabled={false} env={env} />);
      expect(video()).toBeNull();
      expect(status()).toBe('idle');
    });
  });

  it('does nothing at all where there is neither a lock nor a video', () => {
    // A document with no browsing context can play nothing, and has no wake lock either.
    const detached = document.implementation.createHTMLDocument();
    render(
      <Probe
        enabled
        env={{ wakeLock: undefined, document, media: createWakeMediaController(detached) }}
      />,
    );

    expect(status()).toBe('unsupported');
    expect(detached.querySelector('video')).toBeNull();
  });
});
