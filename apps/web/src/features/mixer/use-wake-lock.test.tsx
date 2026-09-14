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
    it('starts on its own, gives up the screen when hidden and comes back unprompted', async () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
      const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
      const env = mediaEnvironment();
      render(<Probe enabled env={env} />);

      // A muted clip is exempt from the autoplay policy, so nobody has to touch anything. That
      // matters because the tablet lights itself up when the machine it charges from boots, and
      // there is no one standing over it to provide a gesture.
      expect(video()).not.toBeNull();
      expect(video()?.muted).toBe(true);
      expect(play).toHaveBeenCalledTimes(1);
      await settle();
      expect(status()).toBe('active');

      act(() => {
        setVisibility('hidden');
      });
      expect(pause).toHaveBeenCalled();
      expect(status()).toBe('idle');

      act(() => {
        setVisibility('visible');
      });
      await settle();
      expect(play).toHaveBeenCalledTimes(2);
      expect(status()).toBe('active');
    });

    it('still takes a gesture as a second chance when the engine refuses on its own', async () => {
      const play = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockRejectedValueOnce(new DOMException('gesture required', 'NotAllowedError'));
      render(<Probe enabled env={mediaEnvironment()} />);

      await settle();
      expect(status()).toBe('denied');
      expect(warn).toHaveBeenCalledTimes(1);

      // An engine that will not start a clip nobody asked for still starts one that was asked
      // for, so the listeners stay on as the fallback.
      play.mockResolvedValue(undefined);
      fireEvent.pointerDown(document.body);
      await settle();
      expect(status()).toBe('active');
    });

    it('holds nothing while the desk is offline, and takes the screen back when it returns', async () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
      const env = mediaEnvironment();
      const { rerender } = render(<Probe enabled={false} env={env} />);

      // The machine the tablet charges from is off: no desk, no reason to burn the screen.
      expect(video()).toBeNull();
      expect(play).not.toHaveBeenCalled();
      expect(status()).toBe('idle');

      // It boots, the socket reconnects, and this has to come back without being touched.
      rerender(<Probe enabled env={env} />);
      expect(video()).not.toBeNull();
      expect(play).toHaveBeenCalledTimes(1);
      await settle();
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

      await settle();
      expect(status()).toBe('denied');
      expect(warn).toHaveBeenCalledTimes(1);

      // A second refusal, from the gesture fallback, is the same refusal.
      fireEvent.pointerDown(document.body);
      await settle();
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
