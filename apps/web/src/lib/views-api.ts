import { viewSchema, viewsListResponseSchema, type View, type ViewWriteBody } from '@flwc/shared';
import { createApiRequest, type Fetcher } from './api-request.js';

export interface ViewsClient {
  list(): Promise<View[]>;
  create(body: ViewWriteBody): Promise<View>;
  update(id: string, body: ViewWriteBody): Promise<View>;
  remove(id: string): Promise<void>;
}

export function createViewsClient(fetcher: Fetcher = fetch): ViewsClient {
  const request = createApiRequest(fetcher, 'Views');

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
