import type { ConnectionGetResponse, ConnectionPutBody } from '@flwc/shared';
import type { ConnectionClient } from '../src/lib/connection-api.js';

interface Deferred {
  resolve(): void;
  reject(error: Error): void;
}

export class FakeConnectionClient implements ConnectionClient {
  state: ConnectionGetResponse = { host: '127.0.0.1', port: 9000, status: 'disconnected' };
  getError: Error | null = null;
  updateError: Error | null = null;
  deferGet = false;
  deferUpdate = false;
  readonly calls: Array<{ method: 'get' } | { method: 'update'; body: ConnectionPutBody }> = [];
  private pendingGet: Deferred | null = null;
  private pendingUpdate: Deferred | null = null;

  constructor(state?: Partial<ConnectionGetResponse>) {
    this.state = { ...this.state, ...state };
  }

  async get(): Promise<ConnectionGetResponse> {
    this.calls.push({ method: 'get' });
    if (this.deferGet) {
      await new Promise<void>((resolve, reject) => {
        this.pendingGet = { resolve, reject };
      });
    }
    if (this.getError !== null) {
      throw this.getError;
    }
    return { ...this.state };
  }

  async update(body: ConnectionPutBody): Promise<ConnectionGetResponse> {
    this.calls.push({ method: 'update', body });
    if (this.deferUpdate) {
      await new Promise<void>((resolve, reject) => {
        this.pendingUpdate = { resolve, reject };
      });
    }
    if (this.updateError !== null) {
      throw this.updateError;
    }
    this.state = { ...this.state, host: body.host, port: body.port };
    return { ...this.state };
  }

  resolveGet(): void {
    this.pendingGet?.resolve();
    this.pendingGet = null;
  }

  resolveUpdate(): void {
    this.pendingUpdate?.resolve();
    this.pendingUpdate = null;
  }

  rejectUpdate(error: Error): void {
    this.pendingUpdate?.reject(error);
    this.pendingUpdate = null;
  }

  get updateCalls(): ConnectionPutBody[] {
    return this.calls.flatMap((call) => (call.method === 'update' ? [call.body] : []));
  }
}
