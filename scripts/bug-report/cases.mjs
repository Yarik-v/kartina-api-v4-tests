// Maps a Playwright JSON results file onto the TEST_CASES.md catalog, case by case,
// through the case-id tags every test carries (`{ tag: '@CNT-11' }`).
import { readFileSync } from 'node:fs';
import { esc, md } from './util.mjs';

/** The projects whose tests carry case tags (setup and teardown don't). */
const TEST_PROJECTS = ['api-v4', 'api-v4-pinned', 'api-v4-mutating'];

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
]);
const findingOf = (/** @type {string} */ description) => FINDING.find(([re]) => re.test(description))?.[1] ?? '?';

/**
 * `skip`: the test ran and skipped itself (no matching live data). `notrun`: it never
 * got to run (its project's dependency failed, a beforeAll failed, the run was cut).
 * @typedef {'pass' | 'pass-known' | 'bug' | 'skip' | 'notrun' | 'gap' | 'fail'} CaseStatus
 * @typedef {{ status: CaseStatus, tests: string, note: string }} CaseResult
 * @typedef {Record<string, string> & { result: CaseResult }} CaseRow  catalog columns (ID, Title, Prio, …) plus the result
 * @typedef {{ title: string, rows: CaseRow[] }} CaseSection
 * @typedef {{ type: string, description?: string }} Annotation
 * @typedef {{ title: string, status: string, expectedStatus: string, results: { status: string }[], annotations: Annotation[] }} TaggedTest
 * @typedef {{ startTime: string, duration: number, expected: number, skipped: number, unexpected: number, flaky: number }} RunStats
 */

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
  // Counted over the test projects only, like the reporters: setup and teardown open
  // and close the session and check nothing.
  /** @type {Record<string, number>} */
  const counts = { expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (!TEST_PROJECTS.includes(test.projectName)) continue;
        counts[test.status] = (counts[test.status] ?? 0) + 1;
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
  const stats = { ...results.stats, expected: counts.expected, skipped: counts.skipped, unexpected: counts.unexpected, flaky: counts.flaky };

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
      return { status: stats.unexpected ? 'fail' : 'pass', tests: `${stats.expected}/${ran}`, note: 'проверяется в каждом тесте прогона' };
    }
    if (tests.length === 0) {
      const reason = row.Automated.replace(/^—\s*/, '').replace(/^\((.*)\)$/, '$1');
      return { status: 'gap', tests: '—', note: md(reason || 'не автоматизирован') };
    }
    const passed = tests.filter((t) => t.status === 'expected').length;
    const count = `${passed}/${tests.length}`;
    if (tests.some((t) => t.status === 'unexpected' || t.status === 'flaky')) {
      return { status: 'fail', tests: count, note: /\*\*(BUG|DOCS BUG)/.test(row.Title) ? 'закреплённый тест упал: баг, похоже, исправлен — проверить' : 'см. отчёт прогона' };
    }
    // A test that skipped itself has expectedStatus 'skipped'; any other 'skipped'
    // outcome is a test that never got to run (Playwright 1.63 reports a project left
    // unrun by a failed dependency with no results, one skipped after a failed beforeAll
    // or a worker crash with a 'skipped' result, a run cut short with 'interrupted').
    const notRun = tests.filter((t) => t.status === 'skipped' && t.expectedStatus !== 'skipped');
    if (notRun.length) {
      const reasons = [...new Set(notRun.map(notRunReason))];
      return { status: 'notrun', tests: count, note: esc(reasons.join('; ')) };
    }
    const skipped = tests.filter((t) => t.status === 'skipped');
    if (skipped.length) {
      const reasons = [...new Set(skipped.map((t) => t.annotations.find((a) => a.type === 'skip')?.description ?? ''))];
      return { status: 'skip', tests: count, note: esc(reasons.join('; ')) };
    }
    const findings = [
      ...new Set(tests.flatMap((t) => t.annotations.filter((a) => a.type === 'known-issue').map((a) => findingOf(a.description ?? '')))),
    ];
    if (/\*\*(BUG|DOCS BUG)/.test(row.Title)) {
      const finding = row.Title.match(/\*\*\[([A-Z]\d)\]\*\*/)?.[1] ?? findings[0];
      const link = finding ? ` — <a href="#${finding}">${finding}</a>` : '';
      // Every pinned test records its known issue when the bug shows; a green one
      // without it saw no bug here (e.g. the staging-only debug trace on production).
      if (!findings.length) return { status: 'pass', tests: count, note: `баг на этом хосте не наблюдался${link}` };
      return { status: 'bug', tests: count, note: `баг воспроизводится${link}` };
    }
    if (findings.length) {
      const links = findings.map((f) => `<a href="#${f}">${f}</a>`).join(', ');
      return { status: 'pass-known', tests: count, note: `пройден; в ответах допущено известное расхождение ${links}` };
    }
    return { status: 'pass', tests: count, note: '' };
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
