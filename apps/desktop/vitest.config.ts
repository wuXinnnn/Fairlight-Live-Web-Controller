import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        // Mounting only; there is nothing here a jsdom test could assert that the App tests do not.
        'src/main.tsx',
        // The real Tauri adapter. It is the seam the tests replace: every test drives the UI
        // through a fake LauncherApi, so exercising this file would mean mocking
        // `@tauri-apps/api` itself, which tests the mock rather than the app.
        'src/tauri-api.ts',
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
