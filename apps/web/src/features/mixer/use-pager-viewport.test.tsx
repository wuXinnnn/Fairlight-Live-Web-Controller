import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePagerViewport } from './use-pager-viewport.js';

function Probe() {
  const { width, attach } = usePagerViewport();
  return (
    <div className="mixer-bays" ref={attach} data-width={width}>
      pager
    </div>
  );
}

describe('usePagerViewport', () => {
  const installed = Reflect.get(globalThis, 'ResizeObserver') as unknown;

  afterEach(() => {
    Reflect.set(globalThis, 'ResizeObserver', installed);
  });

  it('measures the element as soon as it is attached', () => {
    const { container } = render(<Probe />);

    // The suite-wide layout stub gives the pager viewport a width; the point is that the hook
    // reads it on attachment rather than waiting for a resize that may never come.
    expect(container.firstElementChild?.getAttribute('data-width')).not.toBe('0');
  });

  it('keeps the attachment measurement where ResizeObserver is missing', () => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    const { container } = render(<Probe />);

    expect(container.firstElementChild?.getAttribute('data-width')).not.toBe('0');
  });
});
