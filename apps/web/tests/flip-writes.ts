/**
 * Records the inline `style` writes the FLIP list makes, so tests can assert that a row was
 * tweened without racing the animation frame that releases the inverse transform.
 */
export interface FlipWrite {
  key: string;
  transform: string;
}

export interface FlipRecorder {
  /** Every style write seen so far, oldest first. */
  writes(): FlipWrite[];
  /** Keys that received an inverse translate. */
  tweened(): string[];
  stop(): void;
}

export function recordFlipWrites(root: HTMLElement): FlipRecorder {
  const seen: FlipWrite[] = [];
  const latest = new Map<HTMLElement, string>();
  const take = (records: MutationRecord[]): void => {
    for (const record of records) {
      const element = record.target as HTMLElement;
      const transform = element.style.transform;
      // The hook writes `transition` and `transform` separately, so one tween shows up as
      // several style mutations carrying the same transform. Only record it when it changes,
      // or counting tweens would count the writes around them too.
      if (latest.get(element) === transform) {
        continue;
      }
      latest.set(element, transform);
      seen.push({
        key: element.getAttribute('data-flip-key') ?? '',
        transform,
      });
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['style'],
    subtree: true,
  });
  const writes = (): FlipWrite[] => {
    take(observer.takeRecords());
    return [...seen];
  };
  return {
    writes,
    tweened: () =>
      writes()
        .filter((write) => write.transform.startsWith('translate('))
        .map((write) => write.key),
    stop: () => observer.disconnect(),
  };
}
