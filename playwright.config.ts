import { defineConfig, devices, type Project } from '@playwright/test';
import 'dotenv/config';
import { v4BaseURL, v4BrowserOnly, v4MutatingOnly } from './src/config';
import { BROWSER_SESSION_FILE } from './ui-tests/session';
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

// The browser tests (ui-tests/) drive the web client at playtest.kartina.tv. Its
// baseURL is the API, so `page.request` reaches API v4 on the browser's own session
// (see ui-tests/fixtures.ts). No traces: every page load re-logs in with the password
// (POST /login), and the client keeps it in localStorage. One worker: the run holds
// one browser session, and each page load ends the previous one.
const browserUse = { ...devices['Desktop Chrome'], baseURL: v4BaseURL, locale: 'ru-RU', trace: 'off' as const };

const browserProjects: Project[] = [
  // After the account-changing API tests (UI-05 changes the favorites, and the API
  // session plus the browser's stay at two of the account's three slots), or right
  // away with V4_BROWSER_ONLY=1 (`npm run test:browser`).
  {
    name: 'browser-setup',
    testDir: './ui-tests',
    testMatch: /browser\.setup\.ts/,
    teardown: 'browser-teardown',
    dependencies: v4BrowserOnly ? [] : ['api-v4-mutating'],
    use: browserUse,
  },
  {
    name: 'browser-teardown',
    testDir: './ui-tests',
    testMatch: /browser\.teardown\.ts/,
    use: { ...browserUse, storageState: BROWSER_SESSION_FILE },
  },
  {
    name: 'browser-ui',
    testDir: './ui-tests',
    testMatch: /.*\.spec\.ts/,
    dependencies: ['browser-setup'],
    fullyParallel: false,
    workers: 1,
    use: { ...browserUse, storageState: BROWSER_SESSION_FILE, screenshot: 'only-on-failure' },
  },
];

// One login per run (setup), shared through the storage state, and a logout at the
// end (teardown). No traces there: the login request carries the password.
const apiProjects: Project[] = [
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
  // V4_BROWSER_ONLY=1 (`npm run test:browser`): the browser projects alone.
  projects: v4BrowserOnly ? browserProjects : [...apiProjects, ...browserProjects],
  testDir: './tests',
});
