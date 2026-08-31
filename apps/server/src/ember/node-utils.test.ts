import { Model } from 'emberplus-connection';
import { describe, expect, it } from 'vitest';
import {
  childNodes,
  findChildByIdentifier,
  isFunctionNode,
  isParameterNode,
  readBooleanValue,
  readIdentifier,
  readNumericValue,
  readStringValue,
} from './node-utils.js';
import { emberNode, functionNode, parameterNode } from './tree-helpers.js';

describe('ember node utils', () => {
  it('reads identifiers and typed parameter values', () => {
    const numeric = parameterNode(1, 'level', Model.ParameterType.Real, -6);
    const flag = parameterNode(2, 'mute', Model.ParameterType.Boolean, true);
    const name = parameterNode(3, 'name', Model.ParameterType.String, 'BASS');
    const fn = functionNode(4, 'reset');
    const bare = emberNode(5, new Model.EmberNodeImpl());

    expect(readIdentifier(numeric)).toBe('level');
    expect(readIdentifier(bare)).toBeUndefined();
    expect(isParameterNode(numeric)).toBe(true);
    expect(isFunctionNode(fn)).toBe(true);
    expect(isParameterNode(fn)).toBe(false);
    if (isParameterNode(numeric) && isParameterNode(flag) && isParameterNode(name)) {
      expect(readNumericValue(numeric)).toBe(-6);
      expect(readBooleanValue(flag)).toBe(true);
      expect(readStringValue(name)).toBe('BASS');
      expect(readNumericValue(flag)).toBeUndefined();
      expect(readBooleanValue(numeric)).toBeUndefined();
      expect(readStringValue(numeric)).toBeUndefined();
    }
  });

  it('lists children and finds them by identifier', () => {
    const child = parameterNode(1, 'level', Model.ParameterType.Real, 0);
    const parent = emberNode(1, new Model.EmberNodeImpl('channel'), { 1: child });
    expect(childNodes(parent)).toEqual([child]);
    expect(findChildByIdentifier(parent, 'level')).toBe(child);
    expect(findChildByIdentifier(parent, 'mute')).toBeUndefined();
    expect(childNodes(emberNode(2, new Model.EmberNodeImpl('empty')))).toEqual([]);
  });
});
