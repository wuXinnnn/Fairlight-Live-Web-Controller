import { ERROR_CODES } from '@flwc/shared';
import { describe, expect, it } from 'vitest';
import { ChannelNotFoundError, EmberProtocolError } from './errors.js';

describe('ember errors', () => {
  it('exposes protocol and not-found codes', () => {
    const protocol = new EmberProtocolError('down');
    const missing = new ChannelNotFoundError('channel/9');
    expect(protocol.code).toBe(ERROR_CODES.PROTOCOL);
    expect(missing.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(missing.message).toContain('channel/9');
  });
});
