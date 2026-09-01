import { afterEach, describe, expect, it, vi } from 'vitest';

const rootMock = vi.hoisted(() => ({
  element: null as Element | null,
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: (element: Element) => {
    rootMock.element = element;
    return { render: rootMock.render };
  },
}));

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
    rootMock.element = null;
    rootMock.render.mockClear();
    vi.resetModules();
  });

  it('mounts the app into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('./main.js');
    expect(rootMock.element).toBe(document.getElementById('root'));
    expect(rootMock.render).toHaveBeenCalledOnce();
  });

  it('throws when #root is missing', async () => {
    await expect(import('./main.js')).rejects.toThrow('#root');
  });
});
