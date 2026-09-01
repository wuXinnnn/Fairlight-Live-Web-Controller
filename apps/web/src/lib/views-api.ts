import {
  apiErrorSchema,
  viewSchema,
  viewsListResponseSchema,
  type View,
  type ViewWriteBody,
} from '@flwc/shared';

export interface ViewsClient {
  list(): Promise<View[]>;
  create(body: ViewWriteBody): Promise<View>;
  update(id: string, body: ViewWriteBody): Promise<View>;
  remove(id: string): Promise<void>;
}

type Fetcher = typeof fetch;

async function readError(response: Response): Promise<Error> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return new Error(parsed.data.error.message);
    }
  } catch {
    // The status remains useful when an upstream returns a non-JSON error.
  }
  return new Error(`Views request failed with status ${response.status}.`);
}

export function createViewsClient(fetcher: Fetcher = fetch): ViewsClient {
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetcher(path, {
      ...init,
      headers: init?.body === undefined ? init?.headers : { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      throw await readError(response);
    }
    return response;
  };

  return {
    async list() {
      const response = await request('/api/v1/views');
      return viewsListResponseSchema.parse(await response.json());
    },
    async create(body) {
      const response = await request('/api/v1/views', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return viewSchema.parse(await response.json());
    },
    async update(id, body) {
      const response = await request(`/api/v1/views/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return viewSchema.parse(await response.json());
    },
    async remove(id) {
      await request(`/api/v1/views/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
