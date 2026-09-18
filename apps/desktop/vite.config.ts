import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The launcher window is served by Tauri, never by the backend, so there is no proxy here and
// no need to listen on anything but loopback. 1420 is the port `tauri dev` expects by default;
// it is fixed so a busy port fails loudly instead of silently moving the window's dev server.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { target: 'esnext' },
});
