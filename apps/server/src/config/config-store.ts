import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appConfigSchema, defaultAppConfig, type AppConfig } from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';
import type { EmberSeed } from './env-seed.js';

export class ConfigStore {
  private current: AppConfig = defaultAppConfig();
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: AppLogger,
    /** Written to disk on a first start only. See {@link ConfigStore.seedFile}. */
    private readonly seed?: EmberSeed,
  ) {}

  get snapshot(): AppConfig {
    return this.current;
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const result = appConfigSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          { err: result.error.message, path: this.filePath, layer: 'validation' },
          'config invalid, using defaults',
        );
        this.current = defaultAppConfig();
        return this.current;
      }
      this.current = result.data;
      return this.current;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
      // A file that is not there is a first start, and the only moment the environment gets to
      // speak for the endpoint. A file that is there but broken means this has run before, so it
      // falls through to the defaults below however the environment is set.
      if (code === 'ENOENT' && this.seed !== undefined) {
        return this.seedFile(this.seed);
      }
      this.logger.warn(
        { err: errorMessage(error), path: this.filePath, code, layer: 'validation' },
        code === 'ENOENT' ? 'config missing, using defaults' : 'config unreadable, using defaults',
      );
      this.current = defaultAppConfig();
      return this.current;
    }
  }

  /**
   * Writes the seeded defaults on a first start, so that the file the UI edits from then on
   * exists and the endpoint survives the next restart.
   *
   * The write joins `writeTail` like every other write, which keeps a PUT that arrives while the
   * server is still starting from interleaving with it. A directory that cannot be written is
   * not fatal: the process runs on the seeded endpoint, it just has nowhere to remember it, and
   * the next update tries again.
   */
  private async seedFile(seed: EmberSeed): Promise<AppConfig> {
    const seeded = appConfigSchema.parse({ ...defaultAppConfig(), ember: { ...seed } });
    const run = this.writeTail.then(() => this.writeAtomic(seeded));
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    // Assigned before the await, not after: both outcomes leave the seeded config in memory, and
    // a `snapshot` read that interleaves with the write sees the seed rather than bare defaults.
    this.current = seeded;
    try {
      await run;
      this.logger.info(
        { path: this.filePath, host: seed.host, port: seed.port, layer: 'validation' },
        'config seeded from the environment',
      );
    } catch (error) {
      this.logger.warn(
        { err: errorMessage(error), path: this.filePath, layer: 'validation' },
        'config seed could not be written, continuing in memory',
      );
    }
    return seeded;
  }

  async save(config: AppConfig): Promise<AppConfig> {
    const parsed = appConfigSchema.parse(config);
    const run = this.writeTail.then(() => this.writeAtomic(parsed));
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
    this.current = parsed;
    return parsed;
  }

  async update(mutator: (current: AppConfig) => AppConfig): Promise<AppConfig> {
    const run = this.writeTail.then(async () => {
      const next = appConfigSchema.parse(mutator(this.current));
      await this.writeAtomic(next);
      this.current = next;
      return next;
    });
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async writeAtomic(config: AppConfig): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    try {
      await rename(tmpPath, this.filePath);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
      if (code === 'EEXIST' || code === 'EPERM') {
        await rm(this.filePath, { force: true });
        await rename(tmpPath, this.filePath);
        return;
      }
      await rm(tmpPath, { force: true });
      throw error;
    }
  }
}
