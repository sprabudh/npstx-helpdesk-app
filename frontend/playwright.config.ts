import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests run against a live stack: API on :3000 (DEMO_MODE=true) and the web app on :5173. */
const baseURL = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.E2E_BASE_URL ?? 'http://localhost:5173';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', viewport: { width: 1440, height: 1000 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
});
