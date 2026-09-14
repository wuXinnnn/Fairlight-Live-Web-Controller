import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen } from './use-fullscreen.js';

function Probe() {
  const { supported, active, toggle } = useFullscreen();
  return (
    <button type="button" aria-pressed={active} disabled={!supported} onClick={toggle}>
      {supported ? (active ? 'EXIT FULLSCREEN' : 'FULLSCREEN') : 'UNSUPPORTED'}
    </button>
  );
}

/**
 * The real document with the API defined on it, rather than a stand-in object: the listener, the
 * dispatch and the removal are then the ones a browser will run, and the hook's `doc?: Document`
 * signature needs no casting to accept it. jsdom implements none of this natively.
 */
function installFullscreen(): { requestFullscreen: ReturnType<typeof vi.fn> } {
  let element: Element | null = null;
  const fire = () => {
    fireEvent(document, new Event('fullscreenchange'));
  };
  const requestFullscreen = vi.fn((options?: FullscreenOptions) => {
    void options;
    element = document.documentElement;
    fire();
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    element = null;
    fire();
    return Promise.resolve();
  });

  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => element,
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  });
  return { requestFullscreen };
}

function uninstallFullscreen(): void {
  // Everything above was defined as configurable, so deleting the own property puts jsdom back.
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
    Reflect.deleteProperty(document, key);
  }
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
}

describe('useFullscreen', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    uninstallFullscreen();
    vi.restoreAllMocks();
  });

  it('reports no support where the browser has no element full screen', () => {
    render(<Probe />);

    // jsdom, like iPhone Safari, has nothing to offer here.
    expect(screen.getByRole('button')).toHaveTextContent('UNSUPPORTED');
    fireEvent.click(screen.getByRole('button'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('goes in and comes back out again', () => {
    const { requestFullscreen } = installFullscreen();
    render(<Probe />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('FULLSCREEN');

    fireEvent.click(button);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(button).toHaveTextContent('EXIT FULLSCREEN');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button);
    expect(button).toHaveTextContent('FULLSCREEN');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('follows the state out when it is left by some other road', () => {
    installFullscreen();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('EXIT FULLSCREEN');

    // Escape, or a page load that landed here already full screen. The event is all there is.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    fireEvent(document, new Event('fullscreenchange'));

    expect(screen.getByRole('button')).toHaveTextContent('FULLSCREEN');
  });

  it('says nothing on screen when the browser refuses', async () => {
    const { requestFullscreen } = installFullscreen();
    requestFullscreen.mockRejectedValue(new DOMException('gesture required', 'TypeError'));
    render(<Probe />);

    fireEvent.click(screen.getByRole('button'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button')).toHaveTextContent('FULLSCREEN');
    expect(warn).toHaveBeenCalledTimes(1);

    // A second refusal is the same refusal; one line in the console is enough.
    fireEvent.click(screen.getByRole('button'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
