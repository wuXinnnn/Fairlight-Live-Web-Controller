import {
  connectionGetResponseSchema,
  type ConnectionGetResponse,
  type ConnectionPutBody,
} from '@flwc/shared';
import { createApiRequest, type Fetcher } from './api-request.js';

export interface ConnectionClient {
  get(): Promise<ConnectionGetResponse>;
  update(body: ConnectionPutBody): Promise<ConnectionGetResponse>;
}

export function createConnectionClient(fetcher: Fetcher = fetch): ConnectionClient {
  const request = createApiRequest(fetcher, 'Connection');

  return {
    async get() {
      const response = await request('/api/v1/connection');
      return connectionGetResponseSchema.parse(await response.json());
    },
    async update(body) {
      const response = await request('/api/v1/connection', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return connectionGetResponseSchema.parse(await response.json());
    },
  };
}
