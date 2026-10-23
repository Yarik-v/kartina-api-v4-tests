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
    // A failure here leaves api-v4-mutating unrun (a dependency is a pass/fail gate);
    // one retry keeps a transient staging 503 from doing that.
    retries: 1,
    use: v4Use,
  },
  // Known-bug tests turn red on purpose once a bug is fixed, so they stay outside the
  // api-v4 gate. Same phase as api-v4, so they still finish before api-v4-mutating.
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
  // All workers share one session, so this caps concurrent requests, not sessions.
  workers: process.env.CI ? 4 : 5,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['./src/reporters/failuresOnly.ts'], ['./src/reporters/htmlReport.ts']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
  },
  // One login per run (setup), shared through the storage state, and a logout at the
  // end (teardown). No traces there: the login request carries the password.
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
    // With V4_MUTATING_ONLY=1 the read-only projects don't exist, so nothing reads the
    // account while it's being changed.
    ...(v4MutatingOnly ? [] : readOnlyProjects),
    // Tests that change the account run after the read-only ones, one at a time: in
    // parallel they would race reads of the same state (e.g. a hidden channel missing
    // from a count). A failure in api-v4 leaves them unrun.
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
