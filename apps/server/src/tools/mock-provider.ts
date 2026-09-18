/**
 * A standing Mock Ember+ Provider, for the times there is no desk to point at.
 *
 * It serves the archived tree dump over Ember+ on a port of your choosing, optionally feeding it
 * the same synthetic programme the soak driver uses, so the meters and the loudness readouts move
 * the way they would on a show night.
 *
 * Point the server at it with EMBER_HOST and EMBER_PORT, or through the CONNECTION panel. From a
 * container the address is host.docker.internal, which is why this listens on every interface by
 * default rather than on loopback.
 *
 * Excluded from coverage: this is the driver. Its argument parsing lives in `cli-args.ts`, the
 * tree and the listener in `@flwc/test-utils`, and the signal shapes in `soak-signal.ts`, all of
 * which are tested.
 */
import { loadDumpTree, MockEmberProvider, resolveLatestDumpPath } from '@flwc/test-utils';
import { parseMockProviderArgs, SOAK_METER_HZ } from './cli-args.js';
import { resolveRepoPath } from './repo-paths.js';
import { collectMeterPaths, loudnessSignal, meterSignal } from './soak-signal.js';

const USAGE = `usage: pnpm --filter @flwc/server mock-provider --port <port> [options]

  --port <port>   required, the port to listen on (9000 is refused: it is the live desk)
  --host <host>   default 0.0.0.0, so a container can reach it via host.docker.internal
  --dump <path>   default: the newest dump in docs/tree-dumps
  --meters        feed synthetic levels and loudness, so the meters move
`;

/** How often the loudness readouts are refreshed, matching the soak driver. */
const LOUDNESS_INTERVAL_MS = 1000;

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseMockProviderArgs(argv);
  const dumpPath = args.dump === undefined ? resolveLatestDumpPath() : resolveRepoPath(args.dump);
  const dump = loadDumpTree(dumpPath);
  const meterPaths = collectMeterPaths(dump);

  const provider = MockEmberProvider.fromDump(dump, { host: args.host, port: args.port });
  const { host, port } = await provider.listen();

  console.log(`Mock Ember+ Provider listening on ${host}:${port}`);
  console.log(`Tree from ${dumpPath} with ${meterPaths.length} metered channels`);

  let meterTimer: NodeJS.Timeout | undefined;
  let loudnessTimer: NodeJS.Timeout | undefined;

  if (args.meters) {
    const startedAt = Date.now();
    meterTimer = setInterval(() => {
      const t = (Date.now() - startedAt) / 1000;
      meterPaths.forEach((meterPath, index) => {
        provider.pushParameter(meterPath, meterSignal(t, index));
      });
    }, 1000 / SOAK_METER_HZ);
    loudnessTimer = setInterval(() => {
      const t = (Date.now() - startedAt) / 1000;
      const loudness = loudnessSignal(t, meterPaths.length);
      provider.pushParameter('system/loudness/integrated', loudness.integratedLufs);
      provider.pushParameter('system/loudness/true-peak', loudness.truePeakDbtp);
    }, LOUDNESS_INTERVAL_MS);
    console.log(`Feeding levels at ${SOAK_METER_HZ} Hz`);
  }

  console.log('Ctrl+C to stop');

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      clearInterval(meterTimer);
      clearInterval(loudnessTimer);
      provider.close();
      console.log('Mock Ember+ Provider stopped');
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(USAGE);
  process.exitCode = 1;
}
