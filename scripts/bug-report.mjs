// `npm run report:bugs`: builds reports/<date>-api-v4-<env>.html. Runs the suite with
// JSON results, replays the requests behind every finding on its own session
// (capture.mjs) and renders findings, exchanges and per-case results (render.mjs,
// cases.mjs). `--skip-tests` reuses the last results, if no other Playwright run has
// emptied test-results/ since.
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

// The capture sends the real password, so the host must be one the spec names.
assertValidV4Host();
if (!v4Login || !v4Password) throw new Error('Set V4_LOGIN and V4_PASSWORD in .env');

if (!process.argv.includes('--skip-tests')) {
  // Without the read-only projects every case they hold would read as not run.
  if (v4MutatingOnly) throw new Error('V4_MUTATING_ONLY=1 leaves the read-only tests out of the run: unset it for the report');
  // So a run that dies on a config or load error can't leave old results to report as new.
  rmSync(RESULTS, { force: true });
  // The usual reporters too, so `npm run report` shows this run.
  const reporters = ['json', './src/reporters/failuresOnly.ts', './src/reporters/htmlReport.ts'].join(',');
  const run = spawnSync('npx', ['playwright', 'test', `--reporter=${reporters}`], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: RESULTS },
  });
  // Failed tests belong in the report (a pinned bug that stopped reproducing); only a
  // run with no results stops here.
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
// Every request in the report shows the session id: write it only once that session is dead.
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
