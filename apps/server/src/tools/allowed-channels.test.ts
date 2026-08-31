import { describe, expect, it } from 'vitest';
import {
  assertAllowedFaderChannel,
  chooseWriteTarget,
  findChannelLevel,
  isAllowedFaderChannel,
} from './allowed-channels.js';
import type { DumpNode } from './dump-types.js';

const channel: DumpNode = {
  number: 4,
  numberPath: '1.4',
  identifierPath: 'mixer/channel/4',
  identifier: '4',
  elementType: 'NODE',
  children: [
    {
      number: 1,
      numberPath: '1.4.1',
      identifierPath: 'mixer/channel/4/name',
      identifier: 'name',
      elementType: 'PARAMETER',
      value: 'Anagram-Dry',
    },
    {
      number: 2,
      numberPath: '1.4.2',
      identifierPath: 'mixer/channel/4/level',
      identifier: 'level',
      elementType: 'PARAMETER',
      value: -12,
      minimum: -100,
      maximum: 10,
    },
  ],
};

describe('allowed fader channels', () => {
  it('accepts only the four live-safe input names', () => {
    expect(isAllowedFaderChannel('Anagram-Dry')).toBe(true);
    expect(isAllowedFaderChannel('VOX')).toBe(false);
    expect(() => assertAllowedFaderChannel('VOX')).toThrow('Refusing to write channel "VOX"');
  });

  it('finds the level sibling of an allowed channel name', () => {
    expect(findChannelLevel([channel], 'Anagram-Dry')).toEqual({
      channelName: 'Anagram-Dry',
      namePath: 'mixer/channel/4/name',
      levelNumberPath: '1.4.2',
      levelIdentifierPath: 'mixer/channel/4/level',
      currentLevel: -12,
      minimum: -100,
      maximum: 10,
    });
  });

  it('returns undefined when the name exists without a level sibling', () => {
    const nameless: DumpNode = {
      ...channel,
      children: [channel.children?.[0] as DumpNode],
    };
    expect(findChannelLevel([nameless], 'Anagram-Dry')).toBeUndefined();
  });

  it('clamps the write target inside min/max by reversing the delta', () => {
    expect(chooseWriteTarget(10, 1, -100, 10)).toBe(9);
    expect(chooseWriteTarget(-100, -1, -100, 10)).toBe(-99);
    expect(chooseWriteTarget(-12, 1, -100, 10)).toBe(-11);
  });
});
