import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import { v4BaseURL, v4MutatingOnly } from './src/config';
import { MUTATES_TAG, PINNED_TAG, V4_SESSION_FILE } from './tests/session';

const v4Use = {
  baseURL: v4BaseURL,
  storageState: V4_SESSION_FILE,
  extraHTTPHeaders: { Accept: 'application/json' },
};

const readOnlyProjects = [
  {
    name: 'api-v4',
    dependencies: ['api-v4-setup'],
    grepInvert: new RegExp(`${MUTATES_TAG}|${PINNED_TAG}`),
    // A Playwright dependency is a pass/fail gate: one failure here leaves
    // api-v4-mutating unrun. A retry keeps a single transient staging 503 from
    // doing that (a test that passes on retry counts as flaky, not failed).
    retries: 1,
    use: v4Use,
  },
  // The read-only tests that pin a known API bug: they turn red on purpose once the
  // bug is fixed, so they're kept out of api-v4 and that gate. Same phase as api-v4
  // (both depend only on the setup), so they finish before api-v4-mutating starts.
  {
    name: 'api-v4-pinned',
    dependencies: ['api-v4-setup'],
    grep: new RegExp(PINNED_TAG),
    grepInvert: new RegExp(MUTATES_TAG),
    use: v4Use,
  },
];

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
    // With V4_MUTATING_ONLY=1 the read-only projects aren't defined at all:
    // api-v4-mutating then follows the setup directly, and nothing reads the account
    // in the same phase while it's being changed.
    ...(v4MutatingOnly ? [] : readOnlyProjects),
    // Tests that change the account (settings, profiles, favorites, hidden channels,
    // the search history) run after the read-only ones, one at a time: in parallel
    // they would race every read of the same state (a hidden channel missing from
    // a count, a recalculated setting under a playback test). As with any dependency,
    // a failure in api-v4 leaves this project unrun. To run only some of them without
    // the whole read-only suite first: V4_MUTATING_ONLY=1 (see README).
    {
      name: 'api-v4-mutating',
      dependencies: [v4MutatingOnly ? 'api-v4-setup' : 'api-v4'],
      grep: new RegExp(MUTATES_TAG),
      fullyParallel: false,
      workers: 1,
      use: v4Use,
    },
  ],
  testDir: './tests',
});
