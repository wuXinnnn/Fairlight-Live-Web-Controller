import type { DumpNode, DumpTree } from './dump-types.js';

function parameter(
  number: number,
  parentNumber: string,
  parentId: string,
  identifier: string,
  parameterType: string,
  value: string | number | boolean,
  extra: Partial<DumpNode> = {},
): DumpNode {
  return {
    number,
    numberPath: `${parentNumber}.${number}`,
    identifierPath: `${parentId}/${identifier}`,
    identifier,
    elementType: 'PARAMETER',
    parameterType,
    value,
    ...extra,
  };
}

function strip(kind: string, index: number, name: string, number: number): DumpNode {
  const identifier = `${kind}${index}`;
  const numberPath = `${number}.${index}`;
  const identifierPath = `${kind}/${identifier}`;
  return {
    number: index,
    numberPath,
    identifierPath,
    identifier,
    description: name,
    elementType: 'NODE',
    isOnline: true,
    children: [
      parameter(1, numberPath, identifierPath, 'level', 'REAL', -6, {
        minimum: -100,
        maximum: 10,
        access: 'READ_WRITE',
      }),
      parameter(2, numberPath, identifierPath, 'mute', 'BOOLEAN', false, { access: 'READ_WRITE' }),
      parameter(4, numberPath, identifierPath, 'name', 'STRING', name, { access: 'READ_WRITE' }),
      parameter(100, numberPath, identifierPath, 'meter', 'REAL', -20, {
        minimum: -60,
        maximum: 0,
        access: 'READ',
        streamIdentifier: 1,
      }),
    ],
  };
}

export function createRequiredDump(): DumpTree {
  return {
    dumpedAt: '2026-08-31T00:00:00.000Z',
    host: '127.0.0.1',
    port: 9000,
    errors: [],
    nodes: [
      {
        number: 0,
        numberPath: '0',
        identifierPath: 'system',
        identifier: 'system',
        elementType: 'NODE',
        isOnline: true,
        children: [
          {
            number: 2,
            numberPath: '0.2',
            identifierPath: 'system/loudness',
            identifier: 'loudness',
            elementType: 'NODE',
            isOnline: true,
            children: [
              {
                number: 1,
                numberPath: '0.2.1',
                identifierPath: 'system/loudness/reset',
                identifier: 'reset',
                description: 'Reset Loudness',
                elementType: 'FUNCTION',
              },
              parameter(101, '0.2', 'system/loudness', 'integrated', 'REAL', -23, {
                minimum: -100,
                maximum: 18,
                access: 'READ',
              }),
              parameter(102, '0.2', 'system/loudness', 'true-peak', 'REAL', -6, {
                minimum: -60,
                maximum: 0,
                access: 'READ',
              }),
            ],
          },
        ],
      },
      {
        number: 1,
        numberPath: '1',
        identifierPath: 'channel',
        identifier: 'channel',
        elementType: 'NODE',
        isOnline: true,
        children: [strip('channel', 1, 'BASS', 1)],
      },
      {
        number: 2,
        numberPath: '2',
        identifierPath: 'main',
        identifier: 'main',
        elementType: 'NODE',
        isOnline: true,
        children: [strip('main', 1, 'Main', 2)],
      },
      {
        number: 3,
        numberPath: '3',
        identifierPath: 'aux',
        identifier: 'aux',
        elementType: 'NODE',
        isOnline: true,
        children: [strip('aux', 1, 'FX', 3)],
      },
    ],
  };
}
