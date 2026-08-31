import { describe, expect, it } from 'vitest';
import { MockEmberProvider, dumpToEmberTree, findFreePort } from './index.js';
import { createRequiredDump } from './fixtures.js';

describe('test-utils public exports', () => {
  it('exposes the Mock provider and dump helpers', () => {
    expect(typeof MockEmberProvider.fromDump).toBe('function');
    expect(Object.keys(dumpToEmberTree(createRequiredDump()))).toEqual(['0', '1', '2', '3']);
    expect(typeof findFreePort).toBe('function');
  });
});
