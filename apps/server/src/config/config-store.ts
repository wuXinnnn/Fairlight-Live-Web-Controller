import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appConfigSchema, defaultAppConfig, type AppConfig } from '@flwc/shared';
import type { AppLogger } from '../logger.js';
import { errorMessage } from '../logger.js';

export class ConfigStore {
  private current: AppConfig = defaultAppConfig();
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: AppLogger,
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
      this.logger.warn(
        { err: errorMessage(error), path: this.filePath, code, layer: 'validation' },
        code === 'ENOENT' ? 'config missing, using defaults' : 'config unreadable, using defaults',
      );
      this.current = defaultAppConfig();
      return this.current;
    }
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
