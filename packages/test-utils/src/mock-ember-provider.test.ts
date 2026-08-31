import { describe, expect, it } from 'vitest';
import { createRequiredDump } from './fixtures.js';
import { MockEmberProvider } from './mock-ember-provider.js';

describe('MockEmberProvider unit hooks', () => {
  it('throws when reading port before listen and after close', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    expect(() => provider.port).toThrow('not listening');
    await provider.listen();
    expect(provider.port).not.toBe(9000);
    expect(provider.pushParameter('missing/path', 1)).toBe(false);
    provider.close();
    expect(() => provider.port).toThrow('not listening');
    expect(provider.pushParameter('system/loudness/integrated', -10)).toBe(false);
  });

  it('refuses to bind port 9000', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump(), { port: 9000 });
    await expect(provider.listen()).rejects.toThrow('port 9000');
  });

  it('rejects a second listen', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    await provider.listen();
    try {
      await expect(provider.listen()).rejects.toThrow('already listening');
    } finally {
      provider.close();
    }
  });
});
