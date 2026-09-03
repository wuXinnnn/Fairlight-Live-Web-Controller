import type { View, ViewWriteBody } from '@flwc/shared';
import type { ViewsClient } from '../src/lib/views-api.js';

export class FakeViewsClient implements ViewsClient {
  views: View[];
  error: Error | null = null;
  readonly calls: Array<{ method: string; id?: string; body?: ViewWriteBody }> = [];
  private nextId = 1;

  constructor(views: View[] = []) {
    this.views = views.map((view) => ({
      ...view,
      channels: view.channels.map((channel) => ({ ...channel })),
      groups: view.groups.map((group) => ({ ...group })),
    }));
  }

  async list(): Promise<View[]> {
    this.calls.push({ method: 'list' });
    this.throwIfNeeded();
    return this.views;
  }

  async create(body: ViewWriteBody): Promise<View> {
    this.calls.push({ method: 'create', body });
    this.throwIfNeeded();
    const view = { id: `view-${this.nextId++}`, ...body };
    this.views = [...this.views, view];
    return view;
  }

  async update(id: string, body: ViewWriteBody): Promise<View> {
    this.calls.push({ method: 'update', id, body });
    this.throwIfNeeded();
    const view = { id, ...body };
    this.views = this.views.map((candidate) => (candidate.id === id ? view : candidate));
    return view;
  }

  async remove(id: string): Promise<void> {
    this.calls.push({ method: 'remove', id });
    this.throwIfNeeded();
    this.views = this.views.filter((view) => view.id !== id);
  }

  private throwIfNeeded(): void {
    if (this.error !== null) {
      throw this.error;
    }
  }
}
