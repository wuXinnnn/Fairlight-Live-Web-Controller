import { apiErrorSchema } from '@flwc/shared';

export type Fetcher = typeof fetch;
export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

async function readError(response: Response, label: string): Promise<Error> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return new Error(parsed.data.error.message);
    }
  } catch {
    // The status remains useful when an upstream returns a non-JSON error.
  }
  return new Error(`${label} request failed with status ${response.status}.`);
}

/**
 * Wraps `fetch` for the REST clients: JSON bodies get their content type, failed responses
 * become errors carrying the API message or, failing that, the HTTP status.
 */
export function createApiRequest(fetcher: Fetcher, label: string): ApiRequest {
  return async (path, init) => {
    const response = await fetcher(path, {
      ...init,
      headers: init?.body === undefined ? init?.headers : { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      throw await readError(response, label);
    }
    return response;
  };
}
