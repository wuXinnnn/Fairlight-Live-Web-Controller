import { Model } from 'emberplus-connection';
import { describe, expect, it } from 'vitest';
import { dumpNodeToEmber, dumpToEmberTree, fromDumpValue } from './dump-to-ember-tree.js';
import { createRequiredDump } from './fixtures.js';

describe('fromDumpValue', () => {
  it('restores buffers and passes through primitives', () => {
    expect(fromDumpValue(undefined)).toBeUndefined();
    expect(fromDumpValue(3)).toBe(3);
    expect(fromDumpValue({ $buffer: Buffer.from('hi').toString('hex') })).toEqual(
      Buffer.from('hi'),
    );
  });
});

describe('dumpToEmberTree', () => {
  it('rebuilds parameters, functions, and collection keys', () => {
    const tree = dumpToEmberTree(createRequiredDump());
    const loudness = tree[0]?.children?.[2]?.children?.[101];
    expect(loudness?.contents).toMatchObject({
      type: Model.ElementType.Parameter,
      identifier: 'integrated',
      value: -23,
      minimum: -100,
      maximum: 18,
      access: Model.ParameterAccess.Read,
    });
    expect(tree[0]?.children?.[2]?.children?.[1]?.contents).toMatchObject({
      type: Model.ElementType.Function,
      identifier: 'reset',
    });
    expect(tree[1]?.children?.[1]?.children?.[1]?.contents).toMatchObject({
      identifier: 'level',
      parameterType: Model.ParameterType.Real,
    });
  });

  it('maps matrix, template, and unknown parameter types', () => {
    const matrix = dumpNodeToEmber({
      number: 9,
      numberPath: '9',
      identifierPath: 'matrix',
      identifier: 'router',
      elementType: 'MATRIX',
    });
    expect(matrix.contents.type).toBe(Model.ElementType.Matrix);
    const template = dumpNodeToEmber({
      number: 8,
      numberPath: '8',
      identifierPath: 'template',
      elementType: 'TEMPLATE',
      identifier: 'tmpl',
    });
    expect(template.contents.type).toBe(Model.ElementType.Node);
    const unknown = dumpNodeToEmber({
      number: 1,
      numberPath: '1',
      identifierPath: 'x',
      identifier: 'x',
      elementType: 'PARAMETER',
    });
    expect(unknown.contents).toMatchObject({ parameterType: Model.ParameterType.Null });
    const writable = dumpNodeToEmber({
      number: 2,
      numberPath: '2',
      identifierPath: 'w',
      identifier: 'w',
      elementType: 'PARAMETER',
      parameterType: 'INTEGER',
      access: 'WRITE',
    });
    expect(writable.contents).toMatchObject({
      parameterType: Model.ParameterType.Integer,
      access: Model.ParameterAccess.Write,
    });
    expect(
      dumpNodeToEmber({
        number: 4,
        numberPath: '4',
        identifierPath: 'e',
        identifier: 'e',
        elementType: 'PARAMETER',
        parameterType: 'ENUM',
        access: 'READ_WRITE',
        enumeration: 'A\nB',
      }).contents,
    ).toMatchObject({ parameterType: Model.ParameterType.Enum, enumeration: 'A\nB' });
    expect(
      dumpNodeToEmber({
        number: 5,
        numberPath: '5',
        identifierPath: 't',
        identifier: 't',
        elementType: 'PARAMETER',
        parameterType: 'TRIGGER',
      }).contents,
    ).toMatchObject({ parameterType: Model.ParameterType.Trigger });
    expect(
      dumpNodeToEmber({
        number: 6,
        numberPath: '6',
        identifierPath: 'o',
        identifier: 'o',
        elementType: 'PARAMETER',
        parameterType: 'OCTETS',
      }).contents,
    ).toMatchObject({ parameterType: Model.ParameterType.Octets });
    const none = dumpNodeToEmber({
      number: 3,
      numberPath: '3',
      identifierPath: 'n',
      identifier: 'n',
      elementType: 'PARAMETER',
      parameterType: 'BOOLEAN',
      access: 'NONE',
    });
    expect(none.contents).toMatchObject({ access: Model.ParameterAccess.None });
  });
});
