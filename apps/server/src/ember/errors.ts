import { ERROR_CODES } from '@flwc/shared';

export class EmberProtocolError extends Error {
  readonly code = ERROR_CODES.PROTOCOL;

  constructor(message: string) {
    super(message);
    this.name = 'EmberProtocolError';
  }
}

export class ChannelNotFoundError extends Error {
  readonly code = ERROR_CODES.NOT_FOUND;

  constructor(id: string) {
    super(`Unknown channel '${id}'`);
    this.name = 'ChannelNotFoundError';
  }
}
