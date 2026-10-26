// Maps Playwright JSON results onto the TEST_CASES.md catalog via each test's case-id
// tag (`@CNT-11`).
import { readFileSync } from 'node:fs';
import { esc, md } from './util.mjs';

/**
 * Setup and teardown check nothing and carry no case tags. Every other project counts,
 * including ones added later.
 */
const INFRASTRUCTURE_PROJECTS = ['api-v4-setup', 'api-v4-teardown', 'browser-setup', 'browser-teardown'];

/** Known-issue annotation (see src/knownIssues.ts and the pinned tests) → finding of the report. */
const FINDING = /** @type {[RegExp, string][]} */ ([
  [/^trailer-id-ignored/, 'A1'],
  [/^teleteka-stub/, 'A2'],
  [/^search-countries-503/, 'A3'],
  [/^(page-block-unknown-503|block-link-unknown-503)/, 'A4'],
  [/^etag-not-sent/, 'A5'],
  [/^playback-limit-unchecked/, 'A6'],
  [/^radio-group-channel-kind/, 'A7'],
  [/^radio-(play-link-title|null-description)/, 'A8'],
  [/^staging-debug-trace/, 'S1'],
  [/^(search-url-template-format|spec example)/, 'D1'],
  [/^content-service-enum/, 'D2'],
  [/^client-channels-summary/, 'D3'],
  [/^operation-ids/, 'D4'],
  [/^webclient-password-in-localstorage/, 'W1'],
  [/^webclient-radio-stop-tooltip/, 'W2'],
]);
const findingOf = (/** @type {string} */ description) => FINDING.find(([re]) => re.test(description))?.[1] ?? '?';

/**
 * `skip`: the test skipped itself (no live data). `notrun`: it never ran (failed
 * dependency or beforeAll, or the run was cut).
 * @typedef {'pass' | 'pass-known' | 'bug' | 'skip' | 'notrun' | 'gap' | 'fail'} CaseStatus
 * @typedef {{ status: CaseStatus, tests: string, note: string }} CaseResult
 * @typedef {Record<string, string> & { result: CaseResult }} CaseRow  catalog columns (ID, Title, Prio, …) plus the result
 * @typedef {{ title: string, rows: CaseRow[] }} CaseSection
 * @typedef {{ type: string, description?: string }} Annotation
 * @typedef {{ title: string, status: string, expectedStatus: string, results: { status: string }[], annotations: Annotation[] }} TaggedTest
 * `skipped` counts the tests that skipped themselves, `notRun` the ones that never got to run.
 * @typedef {{ startTime: string, duration: number, expected: number, skipped: number, notRun: number, unexpected: number, flaky: number }} RunStats
 */

// A test that skipped itself has expectedStatus 'skipped'; any other 'skipped' never
// ran. Playwright 1.63 gives no results after a failed dependency, a 'skipped' result
// after a failed beforeAll or worker crash, and 'interrupted' for a cut run.
const neverRan = (/** @type {{ status: string, expectedStatus: string }} */ test) => test.status === 'skipped' && test.expectedStatus !== 'skipped';

/** Why a test that didn't skip itself never ran. @param {TaggedTest} test */
function notRunReason(test) {
  const last = test.results.at(-1);
  if (!last) return 'не запускался: упал тест проекта, от которого зависит его проект';
  if (last.status === 'interrupted') return 'не запускался: прогон прерван';
  return 'не запускался: упал beforeAll или воркер в его файле';
}

/**
 * @param {string} resultsPath  Playwright JSON reporter output
 * @param {string} catalogPath  TEST_CASES.md
 */
export function caseResults(resultsPath, catalogPath) {
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
  /** @type {Map<string, TaggedTest[]>} */
  const byCase = new Map();
  // As in src/reporters/runSummary.ts, setup and teardown count only when they fail
  // (a failed login leaves every test unrun).
  /** @type {Record<string, number>} */
  const counts = { expected: 0, skipped: 0, notRun: 0, unexpected: 0, flaky: 0 };
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (INFRASTRUCTURE_PROJECTS.includes(test.projectName)) {
          if (test.status === 'unexpected') counts.unexpected++;
          continue;
        }
        const bucket = neverRan(test) ? 'notRun' : test.status;
        counts[bucket] = (counts[bucket] ?? 0) + 1;
        for (const tag of spec.tags) {
          if (!/^[A-Z]+-\d+$/.test(tag)) continue;
          if (!byCase.has(tag)) byCase.set(tag, []);
          byCase.get(tag)?.push({
            title: spec.title,
            status: test.status,
            expectedStatus: test.expectedStatus,
            results: test.results,
            annotations: test.annotations,
          });
        }
      }
    }
    (suite.suites ?? []).forEach(walk);
  };
  results.suites.forEach(walk);
  /** @type {RunStats} */
  const stats = {
    ...results.stats,
    expected: counts.expected,
    skipped: counts.skipped,
    notRun: counts.notRun,
    unexpected: counts.unexpected,
    flaky: counts.flaky,
  };

  /** @type {CaseSection[]} */
  const sections = [];
  let h2 = '';
  /** @type {CaseSection | null} */
  let current = null;
  /** @type {string[] | null} */
  let header = null;
  for (const line of readFileSync(catalogPath, 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      h2 = line.slice(3).trim();
      if (h2 === 'Remaining gaps') break;
      if (!/^\d/.test(h2)) continue;
      current = { title: h2.replace(/^\d+\.\s*/, ''), rows: [] };
      sections.push(current);
      header = null;
      continue;
    }
    if (line.startsWith('### ')) {
      current = { title: `${h2.replace(/^\d+\.\s*/, '')} · ${line.slice(4).trim().replace(/^\d+\.\d+\s*/, '')}`, rows: [] };
      sections.push(current);
      header = null;
      continue;
    }
    if (!line.startsWith('|') || !current || /^\|[-| ]+\|\s*$/.test(line)) continue;
    const cells = line.slice(1, line.trimEnd().length - 1).split(' | ').map((cell) => cell.trim());
    if (cells[0] === 'ID') {
      header = cells;
      continue;
    }
    if (!header) continue;
    const columns = header;
    const row = /** @type {CaseRow} */ (Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ''])));
    current.rows.push(row);
  }
  const all = sections.flatMap((section) => section.rows);

  /** @param {CaseRow} row @returns {CaseResult} */
  const evaluate = (row) => {
    const id = row.ID;
    const tests = byCase.get(id) ?? [];
    if (id === 'GEN-01') {
      const ran = stats.expected + stats.unexpected + stats.flaky;
      const tests = `${stats.expected + stats.flaky}/${ran}`;
      if (stats.unexpected) return { status: 'fail', tests, note: 'проверяется в каждом тесте прогона' };
      if (!ran) return { status: 'notrun', tests, note: 'ни один тест прогона не выполнился' };
      return { status: 'pass', tests, note: 'проверяется в каждом тесте прогона' };
    }
    if (tests.length === 0) {
      const reason = row.Automated.replace(/^—\s*/, '').replace(/^\((.*)\)$/, '$1');
      return { status: 'gap', tests: '—', note: md(reason || 'не автоматизирован') };
    }
    // A flaky test passed on retry: it counts as passed, with a note.
    const passed = tests.filter((t) => t.status === 'expected' || t.status === 'flaky').length;
    const count = `${passed}/${tests.length}`;
    if (tests.some((t) => t.status === 'unexpected')) {
      return { status: 'fail', tests: count, note: /\*\*(BUG|DOCS BUG)/.test(row.Title) ? 'закреплённый тест упал: баг, похоже, исправлен — проверить' : 'см. отчёт прогона' };
    }
    const notRun = tests.filter(neverRan);
    if (notRun.length) {
      const reasons = [...new Set(notRun.map(notRunReason))];
      return { status: 'notrun', tests: count, note: esc(reasons.join('; ')) };
    }
    const skipped = tests.filter((t) => t.status === 'skipped');
    if (skipped.length) {
      const reasons = [
        ...new Set(skipped.map((t) => t.annotations.find((a) => a.type === 'skip' || a.type === 'fixme')?.description || 'без причины')),
      ];
      return { status: 'skip', tests: count, note: esc(reasons.join('; ')) };
    }
    const flaky = tests.some((t) => t.status === 'flaky') ? 'прошёл со второй попытки' : '';
    /** @param {CaseStatus} status @param {string} note @returns {CaseResult} */
    const result = (status, note) => ({ status, tests: count, note: [note, flaky].filter(Boolean).join('; ') });
    const findings = [
      ...new Set(tests.flatMap((t) => t.annotations.filter((a) => a.type === 'known-issue').map((a) => findingOf(a.description ?? '')))),
    ];
    if (/\*\*(BUG|DOCS BUG)/.test(row.Title)) {
      const finding = row.Title.match(/\*\*\[([A-Z]\d)\]\*\*/)?.[1] ?? findings[0];
      const link = finding ? ` — <a href="#${finding}">${finding}</a>` : '';
      // A pinned test records its known issue when the bug shows; green without it means
      // no bug on this host (e.g. the staging-only debug trace on production).
      if (!findings.length) return result('pass', `баг на этом хосте не наблюдался${link}`);
      return result('bug', `баг воспроизводится${link}`);
    }
    if (findings.length) {
      const links = findings.map((f) => `<a href="#${f}">${f}</a>`).join(', ');
      return result('pass-known', `пройден; в ответах допущено известное расхождение ${links}`);
    }
    return result('pass', '');
  };
  for (const row of all) row.result = evaluate(row);

  /** @type {Partial<Record<CaseStatus, number>>} */
  const tally = {};
  for (const row of all) tally[row.result.status] = (tally[row.result.status] ?? 0) + 1;
  // Consistency of tags and catalog, so a mistake there can't pass unnoticed.
  const problems = [
    ...[...byCase.keys()].filter((id) => !all.some((row) => row.ID === id)).map((id) => `tests tagged @${id}, a case the catalog doesn't have`),
    ...all.filter((row) => row.result.status === 'gap' && !row.Automated.startsWith('—')).map((row) => `${row.ID} is automated in the catalog, but no test carries its tag`),
  ];
  return { sections, all, tally, stats, problems };
}
