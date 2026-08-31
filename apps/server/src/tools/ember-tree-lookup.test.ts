import { Model } from 'emberplus-connection';
import { describe, expect, it } from 'vitest';
import { asParameterNode, getNodeByNumberPath } from './ember-tree-lookup.js';

describe('getNodeByNumberPath', () => {
  const level = new Model.NumberedTreeNodeImpl(
    1,
    new Model.ParameterImpl(Model.ParameterType.Real, 'level', undefined, -6),
  );
  const channel = new Model.NumberedTreeNodeImpl(5, new Model.EmberNodeImpl('channel5'), {
    1: level,
  });
  const tree = {
    1: new Model.NumberedTreeNodeImpl(1, new Model.EmberNodeImpl('channel'), { 5: channel }),
  };

  it('walks numbered segments and returns the leaf', () => {
    expect(getNodeByNumberPath(tree, '1.5.1')?.contents).toMatchObject({
      identifier: 'level',
      value: -6,
    });
  });

  it('returns undefined for a missing or empty path', () => {
    expect(getNodeByNumberPath(tree, '')).toBeUndefined();
    expect(getNodeByNumberPath(tree, '1.9.1')).toBeUndefined();
  });

  it('narrows parameter nodes', () => {
    const node = getNodeByNumberPath(tree, '1.5.1');
    expect(asParameterNode(node, '1.5.1').contents.value).toBe(-6);
    expect(() => asParameterNode(getNodeByNumberPath(tree, '1.5'), '1.5')).toThrow(
      'Expected a parameter',
    );
  });
});
