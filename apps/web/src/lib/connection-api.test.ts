import { describe, expect, it, vi } from 'vitest';
import { createConnectionClient } from './connection-api.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createConnectionClient', () => {
  it('reads the endpoint with and without a last error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ host: '10.0.0.8', port: 9000, status: 'connected' }))
      .mockResolvedValueOnce(
        jsonResponse({
          host: '10.0.0.8',
          port: 9001,
          status: 'reconnecting',
          lastError: 'Timeout after 5000ms: connect',
        }),
      );
    const client = createConnectionClient(fetcher);
    await expect(client.get()).resolves.toEqual({
      host: '10.0.0.8',
      port: 9000,
      status: 'connected',
    });
    await expect(client.get()).resolves.toEqual({
      host: '10.0.0.8',
      port: 9001,
      status: 'reconnecting',
      lastError: 'Timeout after 5000ms: connect',
    });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/connection', { headers: undefined });
  });

  it('updates the endpoint through PUT and parses the response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ host: '10.0.0.9', port: 9000, status: 'connecting' }));
    const client = createConnectionClient(fetcher);
    await expect(client.update({ host: '10.0.0.9', port: 9000 })).resolves.toMatchObject({
      status: 'connecting',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/connection');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ host: '10.0.0.9', port: 9000 }),
      headers: { 'content-type': 'application/json' },
    });
  });

  it('rejects a response that does not match the contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ host: '10.0.0.8' }));
    await expect(createConnectionClient(fetcher).get()).rejects.toThrow();
  });

  it('surfaces 400 and 500 API messages and falls back to the HTTP status', async () => {
    const validation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'VALIDATION', message: 'Port is out of range.' } }, 400),
      );
    await expect(
      createConnectionClient(validation).update({ host: '10.0.0.8', port: 9000 }),
    ).rejects.toThrow('Port is out of range.');

    const internal = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'INTERNAL', message: 'config write failed' } }, 500),
      );
    await expect(createConnectionClient(internal).get()).rejects.toThrow('config write failed');

    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('gateway down', { status: 502 }));
    await expect(createConnectionClient(upstream).get()).rejects.toThrow(
      'Connection request failed with status 502.',
    );
  });
});
