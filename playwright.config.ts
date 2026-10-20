import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import { v4BaseURL } from './src/config';
import { MUTATES_TAG, V4_SESSION_FILE } from './tests/session';

const v4Use = {
  baseURL: v4BaseURL,
  storageState: V4_SESSION_FILE,
  extraHTTPHeaders: { Accept: 'application/json' },
};

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
      grepInvert: new RegExp(MUTATES_TAG),
      use: v4Use,
    },
    // Tests that change the account (settings, profiles, favorites, hidden channels,
    // the search history) run after the read-only ones, one at a time: in parallel
    // they would race every read of the same state (a hidden channel missing from
    // a count, a recalculated setting under a playback test). As with any dependency,
    // a failure in api-v4 leaves this project unrun.
    {
      name: 'api-v4-mutating',
      dependencies: ['api-v4'],
      grep: new RegExp(MUTATES_TAG),
      fullyParallel: false,
      workers: 1,
      use: v4Use,
    },
  ],
  testDir: './tests',
});
