import { defineConfig } from 'vitest/config';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { WASM_RUNTIME_FLAGS } from './src/extraction/wasm-runtime-flags';

const windows = process.platform === 'win32';

/** Keep browser resolution and the Svelte plugin out of every engine suite. */
export default defineConfig({
  test: {
    // SQLite, real Git fixtures, and spawned MCP servers hold short-lived
    // Windows handles. Preserve the fork's serial execution on Windows.
    fileParallelism: windows ? false : undefined,
    testTimeout: windows ? 30_000 : undefined,
    hookTimeout: windows ? 30_000 : undefined,
    globalSetup: ['./__tests__/global-setup-dist.ts', './__tests__/global-setup-home-sandbox.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'engine',
          globals: true,
          environment: 'node',
          include: ['__tests__/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '__tests__/ui-package.test.ts'],
          setupFiles: ['./__tests__/setup-home-sandbox.ts'],
          env: {
            CODEGRAPH_ALLOW_UNSAFE_NODE: '1',
            CODEGRAPH_TELEMETRY: '0',
          },
          // Vitest 4 moved fork options to test.execArgv. These must reach
          // workers as well as spawned CLIs to avoid WASM tier-up crashes.
          pool: 'forks',
          execArgv: [...WASM_RUNTIME_FLAGS],
        },
      },
      {
        // No inheritance: browser conditions must apply only to this project.
        extends: false,
        plugins: [svelte({ preprocess: vitePreprocess() })],
        resolve: { conditions: ['browser'] },
        test: {
          name: 'ui',
          globals: true,
          include: ['__tests__/ui-package.test.ts'],
          environment: 'jsdom',
          server: { deps: { inline: [/@xyflow\/svelte/] } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
