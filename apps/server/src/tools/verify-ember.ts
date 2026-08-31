import { EmberClient, Model } from 'emberplus-connection';
import {
  ALLOWED_FADER_CHANNEL_NAMES,
  assertAllowedFaderChannel,
  chooseWriteTarget,
  findChannelLevel,
} from './allowed-channels.js';
import { parseVerifyEmberArgs } from './cli-args.js';
import type { DumpNode } from './dump-types.js';
import { asParameterNode, getNodeByNumberPath } from './ember-tree-lookup.js';
import { errorMessage, expandEmberTree, withTimeout } from './expand-ember-tree.js';
import { serializeEmberTree } from './serialize-ember-tree.js';

interface Sample {
  at: string;
  path: string;
  value: unknown;
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseVerifyEmberArgs(argv);
  const client = new EmberClient(args.host, args.port, args.timeoutMs);
  client.on('error', (error) => {
    console.error(`Ember+ client error: ${error.message}`);
  });

  await client.connect();
  try {
    await expandEmberTree(client, { timeoutMs: args.timeoutMs, skipIdentifiers: ['sends'] });
    const nodes = serializeEmberTree(Object.values(client.tree));
    await runSubscribe(client, nodes, args.subscribeMs);

    if (!args.confirmWrite) {
      console.log('Skipping write verification (pass --i-confirm to write one allowed fader).');
      return;
    }

    const channelName = assertAllowedFaderChannel(args.channel ?? ALLOWED_FADER_CHANNEL_NAMES[3]);
    await runWrite(client, nodes, channelName, args.deltaDb);
  } finally {
    try {
      await withTimeout(client.disconnect(), 2000, 'disconnect');
    } catch {
      client.discard();
    }
  }
}

async function runSubscribe(
  client: EmberClient,
  nodes: DumpNode[],
  subscribeMs: number,
): Promise<void> {
  const meter = findFirstMeter(nodes);
  const loudness = findByIdentifierPath(nodes, 'system/loudness/integrated');
  if (meter === undefined || loudness === undefined) {
    throw new Error(
      `Could not find subscribe targets. meter=${meter?.identifierPath ?? 'missing'} loudness=${loudness?.identifierPath ?? 'missing'}`,
    );
  }

  const samples: Sample[] = [];
  const record = (path: string, value: unknown) => {
    samples.push({ at: new Date().toISOString(), path, value });
  };

  const meterNode = getNodeByNumberPath(client.tree, meter.numberPath);
  const loudnessNode = getNodeByNumberPath(client.tree, loudness.numberPath);
  if (meterNode === undefined || loudnessNode === undefined) {
    throw new Error('Failed to resolve subscribe nodes on the expanded tree');
  }

  client.on('streamUpdate', (internalPath, value) => {
    if (internalPath === meter.numberPath) {
      record(meter.identifierPath, value);
    }
    if (internalPath === loudness.numberPath) {
      record(loudness.identifierPath, value);
    }
  });

  await client.subscribe(meterNode, (node) => {
    if (node.contents.type === Model.ElementType.Parameter) {
      record(meter.identifierPath, node.contents.value);
    }
  });
  await client.subscribe(loudnessNode, (node) => {
    if (node.contents.type === Model.ElementType.Parameter) {
      record(loudness.identifierPath, node.contents.value);
    }
  });
  console.log(
    `Subscribed to ${meter.identifierPath} and ${loudness.identifierPath} for ${subscribeMs}ms`,
  );
  await sleep(subscribeMs);

  const byPath = groupSamples(samples);
  for (const [path, pathSamples] of byPath) {
    const intervals = intervalsMs(pathSamples);
    const average =
      intervals.length === 0
        ? null
        : intervals.reduce((sum, item) => sum + item, 0) / intervals.length;
    console.log(
      JSON.stringify({
        path,
        samples: pathSamples.length,
        averageIntervalMs: average,
        values: pathSamples.slice(0, 5).map((sample) => sample.value),
      }),
    );
  }
  if (samples.length === 0) {
    console.log(
      JSON.stringify({
        warning: 'No subscription updates received',
        meterPath: meter.identifierPath,
        loudnessPath: loudness.identifierPath,
        meterValue: asParameterNode(meterNode, meter.identifierPath).contents.value,
        loudnessValue: asParameterNode(loudnessNode, loudness.identifierPath).contents.value,
      }),
    );
  }
}

async function runWrite(
  client: EmberClient,
  nodes: DumpNode[],
  channelName: string,
  deltaDb: number,
): Promise<void> {
  const match = findChannelLevel(nodes, channelName);
  if (match === undefined) {
    throw new Error(`Could not find level parameter for allowed channel ${channelName}`);
  }
  if (typeof match.currentLevel !== 'number') {
    throw new Error(
      `Current level for ${channelName} is not a number: ${String(match.currentLevel)}`,
    );
  }

  const target = chooseWriteTarget(match.currentLevel, deltaDb, match.minimum, match.maximum);
  const node = asParameterNode(
    getNodeByNumberPath(client.tree, match.levelNumberPath),
    match.levelIdentifierPath,
  );

  const original = match.currentLevel;
  console.log(
    JSON.stringify({
      step: 'write-plan',
      channel: channelName,
      path: match.levelIdentifierPath,
      numberPath: match.levelNumberPath,
      original,
      target,
      at: new Date().toISOString(),
    }),
  );

  const written = await setAndRead(client, node, target);
  console.log(
    JSON.stringify({ step: 'write-readback', value: written, at: new Date().toISOString() }),
  );
  if (written !== target) {
    throw new Error(`Write readback mismatch: expected ${target}, got ${String(written)}`);
  }

  const restored = await setAndRead(client, node, original);
  console.log(
    JSON.stringify({ step: 'restore-readback', value: restored, at: new Date().toISOString() }),
  );
  if (restored !== original) {
    throw new Error(`Restore readback mismatch: expected ${original}, got ${String(restored)}`);
  }
}

async function setAndRead(
  client: EmberClient,
  node: Model.NumberedTreeNode<Model.Parameter>,
  value: number,
): Promise<unknown> {
  const request = await client.setValue(node, value);
  if (request.response !== undefined) {
    await request.response;
  }
  return node.contents.value;
}

function findFirstMeter(nodes: readonly DumpNode[]): DumpNode | undefined {
  for (const node of nodes) {
    if (node.identifier === 'meter' && node.elementType === 'PARAMETER') {
      return node;
    }
    const nested = findFirstMeter(node.children ?? []);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function findByIdentifierPath(
  nodes: readonly DumpNode[],
  identifierPath: string,
): DumpNode | undefined {
  for (const node of nodes) {
    if (node.identifierPath === identifierPath) {
      return node;
    }
    const nested = findByIdentifierPath(node.children ?? [], identifierPath);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function groupSamples(samples: Sample[]): Map<string, Sample[]> {
  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.path) ?? [];
    list.push(sample);
    grouped.set(sample.path, list);
  }
  return grouped;
}

function intervalsMs(samples: Sample[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    intervals.push(Date.parse(current.at) - Date.parse(previous.at));
  }
  return intervals;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
