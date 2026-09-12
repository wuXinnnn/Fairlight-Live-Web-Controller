/**
 * jsdom has no `ResizeObserver`, and the mixer needs one to know how wide its pager viewport is.
 * This double records what it observes and does nothing until a test resizes an element, so
 * measurement stays a deliberate step of the test rather than something that happens on its own.
 */

type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const live = new Set<StubResizeObserver>();

class StubResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: Callback) {
    live.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    live.delete(this);
  }

  /** Reports a new size for `target` if this observer is watching it. */
  report(target: Element, width: number, height: number): boolean {
    if (!this.targets.has(target)) {
      return false;
    }
    // jsdom has no ResizeObserverEntry either; the mixer only reads `contentRect`.
    const entry = {
      target,
      contentRect: { width, height } as DOMRectReadOnly,
    } as ResizeObserverEntry;
    this.callback([entry], this);
    return true;
  }
}

/** Installs the double on `globalThis` and returns a function that removes it again. */
export function stubResizeObserver(): () => void {
  const original = Reflect.get(globalThis, 'ResizeObserver') as unknown;
  Reflect.set(globalThis, 'ResizeObserver', StubResizeObserver);
  return () => {
    live.clear();
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } else {
      Reflect.set(globalThis, 'ResizeObserver', original);
    }
  };
}

/** Delivers a resize to every observer watching `target`; returns how many were notified. */
export function notifyResizeObservers(target: Element, width: number, height: number): number {
  let notified = 0;
  for (const observer of [...live]) {
    if (observer.report(target, width, height)) {
      notified += 1;
    }
  }
  return notified;
}
