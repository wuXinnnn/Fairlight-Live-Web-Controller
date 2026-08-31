import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EmberClient } from 'emberplus-connection';
import { parseDumpTreeArgs } from './cli-args.js';
import type { DumpTree } from './dump-types.js';
import { expandEmberTree, withTimeout } from './expand-ember-tree.js';
import { resolveRepoPath } from './repo-paths.js';
import { serializeEmberTree } from './serialize-ember-tree.js';

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseDumpTreeArgs(argv);
  const outPath = resolveRepoPath(args.out);
  const client = new EmberClient(args.host, args.port, args.timeoutMs);
  client.on('error', (error) => {
    console.error(`Ember+ client error: ${error.message}`);
  });

  await client.connect();
  try {
    const { errors } = await expandEmberTree(client, { timeoutMs: args.timeoutMs });
    const dump: DumpTree = {
      dumpedAt: new Date().toISOString(),
      host: args.host,
      port: args.port,
      nodes: serializeEmberTree(
        Object.values(client.tree),
        new Map(errors.map((error) => [error.path, error.message])),
      ),
      errors,
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${dump.nodes.length} root node(s) to ${outPath}`);
    console.log(`Expand errors: ${errors.length}`);
    for (const error of errors) {
      console.error(`  ${error.path}: ${error.message}`);
    }
  } finally {
    await closeClient(client);
  }
}

async function closeClient(client: EmberClient): Promise<void> {
  try {
    await withTimeout(client.disconnect(), 2000, 'disconnect');
  } catch {
    client.discard();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
