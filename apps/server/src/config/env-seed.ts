import {
  DEFAULT_EMBER_HOST,
  DEFAULT_EMBER_PORT,
  connectionPutBodySchema,
  type ConnectionPutBody,
} from '@flwc/shared';
import type { AppLogger } from '../logger.js';

/**
 * An Ember+ endpoint to write into a config file that does not exist yet. It is the same shape,
 * and validated by the same schema, as the body of `PUT /api/v1/connection`.
 */
export type EmberSeed = ConnectionPutBody;

export const EMBER_HOST_ENV = 'EMBER_HOST';
export const EMBER_PORT_ENV = 'EMBER_PORT';

/**
 * The endpoint the environment asks for on a first start, if it asks for one at all.
 *
 * This exists for the container and the compose file, where there is no UI to configure before
 * the first start and no config file to edit. It seeds; it does not override. Once the file is
 * there, the file and the CONNECTION panel own the endpoint and these variables are ignored.
 *
 * A bad value is a warning, never a throw. An environment variable somebody typed wrong should
 * not be able to stop the server coming up: without an endpoint the UI is still reachable and
 * the panel can still be used to fix it.
 */
export function readEmberSeed(env: NodeJS.ProcessEnv, logger: AppLogger): EmberSeed | undefined {
  const rawHost = env[EMBER_HOST_ENV];
  const rawPort = env[EMBER_PORT_ENV];
  if (rawHost === undefined && rawPort === undefined) {
    return undefined;
  }

  const candidate = {
    host: rawHost ?? DEFAULT_EMBER_HOST,
    port: rawPort === undefined ? DEFAULT_EMBER_PORT : Number(rawPort),
  };
  const result = connectionPutBodySchema.safeParse(candidate);
  if (!result.success) {
    logger.warn(
      {
        err: result.error.message,
        host: rawHost,
        port: rawPort,
        layer: 'validation',
      },
      'ignoring an invalid Ember endpoint in the environment',
    );
    return undefined;
  }
  return result.data;
}
