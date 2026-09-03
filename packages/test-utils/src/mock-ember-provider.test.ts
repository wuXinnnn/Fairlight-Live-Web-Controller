import { describe, expect, it } from 'vitest';
import { dumpNodeToEmber } from './dump-to-ember-tree.js';
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

  it('rejects structure edits before listen', () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    const channel = createRequiredDump().nodes.find((node) => node.identifier === 'channel');
    const strip = channel?.children?.[0];
    expect(strip).toBeDefined();
    if (strip === undefined) {
      return;
    }
    expect(provider.addNode('channel', dumpNodeToEmber(strip))).toBe(false);
    expect(provider.setNodeOnline('channel/channel1', false)).toBe(false);
    expect(provider.getNode('channel')).toBeUndefined();
  });

  it('rejects structure edits for unknown paths', async () => {
    const provider = MockEmberProvider.fromDump(createRequiredDump());
    await provider.listen();
    try {
      const channel = createRequiredDump().nodes.find((node) => node.identifier === 'channel');
      const strip = channel?.children?.[0];
      expect(strip).toBeDefined();
      if (strip === undefined) {
        return;
      }
      expect(provider.addNode('missing', dumpNodeToEmber(strip))).toBe(false);
      expect(
        provider.addNode(
          'channel',
          dumpNodeToEmber({ ...strip, number: 9, identifier: 'channel9' }),
          {
            notify: false,
          },
        ),
      ).toBe(true);
      expect(provider.getNode('channel/channel9')?.contents).toMatchObject({
        identifier: 'channel9',
      });
      expect(provider.setNodeOnline('channel/missing', false)).toBe(false);
      expect(provider.getNode('channel')?.contents).toMatchObject({ identifier: 'channel' });
    } finally {
      provider.close();
    }
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
