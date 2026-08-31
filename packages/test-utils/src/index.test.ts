import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('test-utils skeleton', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@flwc/test-utils');
  });
});
