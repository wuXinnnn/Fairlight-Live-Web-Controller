import { describe, expect, it, vi } from 'vitest';
import { createViewsClient } from './views-api.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createViewsClient', () => {
  it('lists and parses views', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([
        {
          id: 'foh',
          name: 'FOH',
          channels: [{ channelId: 'channel/1', lastKnownName: 'BASS' }],
        },
      ]),
    );
    const client = createViewsClient(fetcher);
    await expect(client.list()).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/views', {
      headers: undefined,
    });
  });

  it('creates, updates, and deletes through the REST contract', async () => {
    const body = { name: 'Broadcast', channels: [] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'broadcast', ...body }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'broadcast', name: 'Studio', channels: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createViewsClient(fetcher);

    await expect(client.create(body)).resolves.toMatchObject({ id: 'broadcast' });
    await expect(client.update('broadcast', { ...body, name: 'Studio' })).resolves.toMatchObject({
      name: 'Studio',
    });
    await expect(client.remove('broadcast')).resolves.toBeUndefined();

    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/v1/views/broadcast');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('surfaces API errors and falls back to the HTTP status', async () => {
    const apiFailure = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'VALIDATION', message: 'View name cannot be empty.' },
        },
        400,
      ),
    );
    await expect(createViewsClient(apiFailure).list()).rejects.toThrow(
      'View name cannot be empty.',
    );

    const upstreamFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('gateway down', { status: 502 }));
    await expect(createViewsClient(upstreamFailure).list()).rejects.toThrow(
      'Views request failed with status 502.',
    );
  });
});
