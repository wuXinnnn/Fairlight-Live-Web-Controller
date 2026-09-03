let counter = 0;

/**
 * Creates an identifier that is unique within this browser session. It deliberately avoids
 * `crypto.randomUUID()`, which browsers only expose in secure contexts while the controller is
 * served over plain HTTP on the studio network.
 */
export function createLocalId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
