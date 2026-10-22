// `npm run report:bugs`: builds the developer bug report, reports/<date>-api-v4-<env>.html.
//   1. runs the suite with a JSON results file (test-results/bug-report/results.json);
//   2. replays the requests behind every finding on a session of its own and records
//      them as sent and received (scripts/bug-report/capture.mjs);
//   3. renders the findings, those exchanges and the per-case results of the run
//      against TEST_CASES.md (render.mjs, cases.mjs).
// `--skip-tests` reuses the results of the last such run instead of step 1 (they live
// in test-results/, which any other Playwright run empties).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_LABELS, assertValidV4Host, v4Device, v4Host, v4Login, v4MutatingOnly, v4Origin, v4Password } from '../src/env.mjs';
import { capture } from './bug-report/capture.mjs';
import { caseResults } from './bug-report/cases.mjs';
import { render } from './bug-report/render.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK_DIR = path.join(ROOT, 'test-results', 'bug-report');
const RESULTS = path.join(WORK_DIR, 'results.json');

// Same settings and the same host check as the tests (src/env.mjs): the capture sends
// the real login and password, so it must never go anywhere the spec doesn't name.
assertValidV4Host();
if (!v4Login || !v4Password) throw new Error('Set V4_LOGIN and V4_PASSWORD in .env');

if (!process.argv.includes('--skip-tests')) {
  // The report needs the whole suite: with V4_MUTATING_ONLY the read-only projects
  // aren't in the run, and every case they hold would read as not run.
  if (v4MutatingOnly) throw new Error('V4_MUTATING_ONLY=1 leaves the read-only tests out of the run: unset it for the report');
  // Removed up front: a run that dies before Playwright cleans test-results/ (a
  // config or load error) must not leave the previous results to be reported as new.
  rmSync(RESULTS, { force: true });
  // The usual reporters too, so `npm run report` still has this run's HTML report.
  const reporters = ['json', './src/reporters/failuresOnly.ts', './src/reporters/htmlReport.ts'].join(',');
  const run = spawnSync('npx', ['playwright', 'test', `--reporter=${reporters}`], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: RESULTS },
  });
  // Failed tests are part of the report (a pinned bug that stopped reproducing), so
  // only a run that produced no results at all stops here.
  if (!existsSync(RESULTS)) throw new Error(`The test run left no ${RESULTS} (exit code ${run.status})`);
} else if (!existsSync(RESULTS)) {
  throw new Error(`--skip-tests: no ${RESULTS} from an earlier run`);
}

const cases = caseResults(RESULTS, path.join(ROOT, 'TEST_CASES.md'));
if (cases.problems.length) throw new Error(`Test tags and TEST_CASES.md disagree:\n${cases.problems.join('\n')}`);

const date = new Date().toISOString().slice(0, 10);
const captured = await capture({
  base: v4Origin,
  login: v4Login,
  password: v4Password,
  device: v4Device,
  serial: `bugreport-${date}`,
});
// The report shows the capture's session id in every request: it's written only once
// that session is confirmed dead.
if (!captured.out.sessionClosed) {
  throw new Error(
    `The capture's session (serial bugreport-${date}) could not be confirmed closed, so no report was written: ` +
      'it would publish a live session id. Run `npm run report:bugs -- --skip-tests` again in a moment.' +
      (captured.out.logoutError ? ` (${captured.out.logoutError})` : ''),
  );
}

const hostLabel = HOST_LABELS[v4Host] ?? v4Host;
const out = path.join(ROOT, 'reports', `${date}-api-v4-${hostLabel}.html`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, render({ capture: captured, cases, hostLabel: hostLabel[0].toUpperCase() + hostLabel.slice(1) }));
console.log(`Wrote ${path.relative(ROOT, out)}: ${captured.log.length} exchanges, ${cases.all.length} cases`);
