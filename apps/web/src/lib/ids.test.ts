import { describe, expect, it } from 'vitest';
import { createLocalId } from './ids.js';

describe('createLocalId', () => {
  it('produces prefixed ids that never repeat within a session', () => {
    const first = createLocalId('g');
    const second = createLocalId('g');
    expect(first).toMatch(/^g-[0-9a-z]+-[0-9a-z]+$/);
    expect(second).not.toBe(first);
  });
});
