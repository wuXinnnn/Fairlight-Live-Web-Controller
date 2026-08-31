import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/tools/dump-tree.ts',
        'src/tools/verify-ember.ts',
        'src/ember/tree-helpers.ts',
        'src/ember/fake-ember-client.ts',
        'src/main.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
