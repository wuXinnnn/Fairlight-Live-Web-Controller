import { describe, expect, it } from 'vitest';
import { assertNotLiveFairlightPort, findFreePort } from './find-free-port.js';

describe('findFreePort', () => {
  it('allocates an unused TCP port on localhost', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(9000);
  });

  it('refuses the live Fairlight port', () => {
    expect(() => assertNotLiveFairlightPort(9000)).toThrow(
      'Refusing to bind Mock Ember+ Provider on port 9000',
    );
    expect(() => assertNotLiveFairlightPort(19000)).not.toThrow();
  });
});
