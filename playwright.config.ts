import { defineConfig, devices } from '@playwright/test';

/*
 * Browser tests for the /games pages (`npm run e2e`). They drive the real pages in dummy mode (`?dummy=1`), so they
 * need no database, no keys and no account: the dev server is started with the preview tools on and a placeholder
 * Supabase address. Not part of `npm test` (vitest runs in node, with no browser); the files end in `.e2e.ts` so
 * vitest never picks them up.
 */
const PORT = 4181;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 900 },
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_PREVIEW_TOOLS: 'true',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'placeholder',
    },
  },
});
