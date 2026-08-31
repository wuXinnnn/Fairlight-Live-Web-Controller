import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
  io: () => ({
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe('main', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('mounts the app into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('./main.js');
    await waitFor(() => {
      expect(document.getElementById('root')?.textContent).toContain('CONTROL DESK');
    });
  });

  it('throws when #root is missing', async () => {
    await expect(import('./main.js')).rejects.toThrow('#root');
  });
});
