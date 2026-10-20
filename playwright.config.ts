import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import { v4BaseURL } from './src/config';
import { V4_SESSION_FILE } from './tests/session';

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Every worker shares the one session the setup opens (see tests/auth.setup.ts), so
  // this caps concurrent requests, not sessions.
  workers: process.env.CI ? 4 : 5,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['./src/reporters/failuresOnly.ts'], ['./src/reporters/htmlReport.ts']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
  },
  // One login for the whole run (setup), shared by every test through the storage
  // state, and a logout at the end (teardown). Neither of the two records a trace:
  // the setup's request carries the password.
  projects: [
    {
      name: 'api-v4-setup',
      testMatch: /auth\.setup\.ts/,
      teardown: 'api-v4-teardown',
      use: { baseURL: v4BaseURL, trace: 'off' },
    },
    {
      name: 'api-v4-teardown',
      testMatch: /auth\.teardown\.ts/,
      use: { baseURL: v4BaseURL, storageState: V4_SESSION_FILE, trace: 'off' },
    },
    {
      name: 'api-v4',
      dependencies: ['api-v4-setup'],
      use: {
        baseURL: v4BaseURL,
        storageState: V4_SESSION_FILE,
        extraHTTPHeaders: { Accept: 'application/json' },
      },
    },
  ],
  testDir: './tests',
});
