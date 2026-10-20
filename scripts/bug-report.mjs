// `npm run report:bugs`: builds the developer bug report, reports/<date>-api-v4-<env>.html.
//   1. runs the suite with a JSON results file (test-results/bug-report/results.json);
//   2. replays the requests behind every finding on a session of its own and records
//      them as sent and received (scripts/bug-report/capture.mjs);
//   3. renders the findings, those exchanges and the per-case results of the run
//      against TEST_CASES.md (render.mjs, cases.mjs).
// `--skip-tests` reuses the results of the last such run instead of step 1.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture } from './bug-report/capture.mjs';
import { caseResults } from './bug-report/cases.mjs';
import { render } from './bug-report/render.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK_DIR = path.join(ROOT, 'test-results', 'bug-report');
const RESULTS = path.join(WORK_DIR, 'results.json');
const HOST_LABELS = /** @type {Record<string, string>} */ ({ 'rustvt.kartina.tv': 'staging', 'iptv.kartina.tv': 'production' });

const host = process.env.V4_API_HOST ?? 'rustvt.kartina.tv';
const login = process.env.V4_LOGIN ?? '';
const password = process.env.V4_PASSWORD ?? '';
if (!login || !password) throw new Error('Set V4_LOGIN and V4_PASSWORD in .env');

if (!process.argv.includes('--skip-tests')) {
  // Playwright empties test-results/ when a run starts, so the results land there
  // only after it; the capture below writes nothing of its own to disk.
  const run = spawnSync('npx', ['playwright', 'test', '--reporter=json,./src/reporters/failuresOnly.ts'], {
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
  base: `${process.env.V4_API_SCHEME ?? 'https'}://${host}/api/v4`,
  login,
  password,
  device: process.env.V4_DEVICE ?? 'androidtv-yb-005',
  serial: `bugreport-${date}`,
});

const hostLabel = HOST_LABELS[host] ?? host;
const out = path.join(ROOT, 'reports', `${date}-api-v4-${hostLabel}.html`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, render({ capture: captured, cases, hostLabel: hostLabel[0].toUpperCase() + hostLabel.slice(1) }));
console.log(`Wrote ${path.relative(ROOT, out)}: ${captured.log.length} exchanges, ${cases.all.length} cases`);
