import { Model } from 'emberplus-connection';
import { describe, expect, it } from 'vitest';
import {
  joinIdentifierPath,
  joinNumberPath,
  serializeEmberTree,
  toDumpValue,
} from './serialize-ember-tree.js';

describe('path helpers', () => {
  it('joins numbered and identifier paths', () => {
    expect(joinNumberPath('', 1)).toBe('1');
    expect(joinNumberPath('1.2', 3)).toBe('1.2.3');
    expect(joinIdentifierPath('', 'system', 1)).toBe('system');
    expect(joinIdentifierPath('system', undefined, 2)).toBe('system/2');
  });
});

describe('toDumpValue', () => {
  it('keeps JSON-safe primitives and encodes buffers', () => {
    expect(toDumpValue(undefined)).toBeUndefined();
    expect(toDumpValue(null)).toBeNull();
    expect(toDumpValue(1.5)).toBe(1.5);
    expect(toDumpValue(true)).toBe(true);
    expect(toDumpValue('LUFS')).toBe('LUFS');
    expect(toDumpValue(Buffer.from('ab'))).toEqual({ $buffer: Buffer.from('ab').toString('hex') });
  });
});

describe('serializeEmberTree', () => {
  it('extracts parameter metadata and child paths', () => {
    const level = new Model.NumberedTreeNodeImpl(
      2,
      new Model.ParameterImpl(
        Model.ParameterType.Real,
        'level',
        'Level',
        -6.5,
        10,
        -100,
        Model.ParameterAccess.ReadWrite,
        '%f dB',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        17,
      ),
    );
    const name = new Model.NumberedTreeNodeImpl(
      1,
      new Model.ParameterImpl(
        Model.ParameterType.String,
        'name',
        'Name',
        'BASS',
        undefined,
        undefined,
        Model.ParameterAccess.ReadWrite,
      ),
    );
    const channel = new Model.NumberedTreeNodeImpl(
      3,
      new Model.EmberNodeImpl('channel', 'Channel'),
      {
        1: name,
        2: level,
      },
    );
    const reset = new Model.NumberedTreeNodeImpl(
      3,
      new Model.EmberFunctionImpl('reset', 'Reset loudness'),
    );
    const root = new Model.NumberedTreeNodeImpl(
      1,
      new Model.EmberNodeImpl('mixer', 'Mixer', true),
      {
        3: channel,
      },
    );
    const system = new Model.NumberedTreeNodeImpl(2, new Model.EmberNodeImpl('system'), {
      3: reset,
    });

    const dump = serializeEmberTree([root, system], new Map([['1.3', 'expand failed']]));
    expect(dump).toHaveLength(2);
    expect(dump[0]?.identifierPath).toBe('mixer');
    expect(dump[0]?.children?.[0]?.error).toBe('expand failed');
    expect(dump[0]?.children?.[0]?.children).toEqual([
      expect.objectContaining({
        identifierPath: 'mixer/channel/name',
        numberPath: '1.3.1',
        value: 'BASS',
      }),
      expect.objectContaining({
        identifierPath: 'mixer/channel/level',
        parameterType: Model.ParameterType.Real,
        access: Model.ParameterAccess.ReadWrite,
        format: '%f dB',
        minimum: -100,
        maximum: 10,
        streamIdentifier: 17,
        value: -6.5,
      }),
    ]);
    expect(dump[1]?.children?.[0]).toMatchObject({
      identifierPath: 'system/reset',
      elementType: 'FUNCTION',
      description: 'Reset loudness',
    });
  });
});
