import { Model } from 'emberplus-connection';
import type { EmberCollection, EmberTreeNode } from './types.js';

export function emberNode(
  number: number,
  contents: Model.EmberElement,
  children?: { [index: number]: EmberTreeNode },
): EmberTreeNode {
  return new Model.NumberedTreeNodeImpl(number, contents, children);
}

export function parameterNode(
  number: number,
  identifier: string,
  type: Model.ParameterType,
  value: string | number | boolean,
): EmberTreeNode {
  return emberNode(number, new Model.ParameterImpl(type, identifier, undefined, value));
}

export function functionNode(number: number, identifier: string): EmberTreeNode {
  return emberNode(number, new Model.EmberFunctionImpl(identifier));
}

export function stripNode(
  kind: string,
  index: number,
  name: string,
  options: { includeMeter?: boolean; includeName?: boolean } = {},
): EmberTreeNode {
  const includeMeter = options.includeMeter ?? true;
  const includeName = options.includeName ?? true;
  const children: { [index: number]: EmberTreeNode } = {
    1: parameterNode(1, 'level', Model.ParameterType.Real, -6),
    2: parameterNode(2, 'mute', Model.ParameterType.Boolean, false),
  };
  if (includeName) {
    children[4] = parameterNode(4, 'name', Model.ParameterType.String, name);
  }
  if (includeMeter) {
    children[100] = parameterNode(100, 'meter', Model.ParameterType.Real, -20);
  }
  return emberNode(index, new Model.EmberNodeImpl(`${kind}${index}`, name), children);
}

export function loudnessNode(): EmberTreeNode {
  return emberNode(2, new Model.EmberNodeImpl('loudness'), {
    1: functionNode(1, 'reset'),
    101: parameterNode(101, 'integrated', Model.ParameterType.Real, -23),
    102: parameterNode(102, 'true-peak', Model.ParameterType.Real, -6),
  });
}

export function requiredTree(options: { includeSub?: boolean } = {}): EmberCollection {
  const tree: { [index: number]: EmberTreeNode } = {
    0: emberNode(0, new Model.EmberNodeImpl('system'), { 2: loudnessNode() }),
    1: emberNode(1, new Model.EmberNodeImpl('channel'), {
      1: stripNode('channel', 1, 'BASS'),
    }),
    2: emberNode(2, new Model.EmberNodeImpl('main'), {
      1: stripNode('main', 1, 'Main'),
    }),
    3: emberNode(3, new Model.EmberNodeImpl('aux'), {
      1: stripNode('aux', 1, 'FX'),
    }),
    8: emberNode(8, new Model.EmberNodeImpl('monitor')),
  };
  if (options.includeSub === true) {
    tree[4] = emberNode(4, new Model.EmberNodeImpl('sub'), {
      1: stripNode('sub', 1, 'Sub'),
    });
  }
  return tree;
}
