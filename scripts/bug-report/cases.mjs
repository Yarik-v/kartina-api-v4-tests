// Maps a Playwright JSON results file onto the TEST_CASES.md catalog, case by case,
// through the case-id tags every test carries (`{ tag: '@CNT-11' }`).
import { readFileSync } from 'node:fs';

/** @param {unknown} s */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The little Markdown the catalog cells use: `code`, **bold**, [links](…) and **[A1]** report tags. */
export const md = (/** @type {string} */ s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\[([A-Z]\d)\]\*\*/g, '<a href="#$1">[$1]</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

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
 * @typedef {'pass' | 'pass-known' | 'bug' | 'skip' | 'gap' | 'fail'} CaseStatus
 * @typedef {{ status: CaseStatus, tests: string, note: string }} CaseResult
 * @typedef {Record<string, string> & { result: CaseResult }} CaseRow  catalog columns (ID, Title, Prio, …) plus the result
 * @typedef {{ title: string, rows: CaseRow[] }} CaseSection
 * @typedef {{ type: string, description?: string }} Annotation
 * @typedef {{ title: string, status: string, annotations: Annotation[] }} TaggedTest
 * @typedef {{ startTime: string, duration: number, expected: number, skipped: number, unexpected: number, flaky: number }} RunStats
 */

/**
 * @param {string} resultsPath  Playwright JSON reporter output
 * @param {string} catalogPath  TEST_CASES.md
 */
export function caseResults(resultsPath, catalogPath) {
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
  /** @type {Map<string, TaggedTest[]>} */
  const byCase = new Map();
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.projectName !== 'api-v4') continue;
        for (const tag of spec.tags) {
          if (!/^[A-Z]+-\d+$/.test(tag)) continue;
          if (!byCase.has(tag)) byCase.set(tag, []);
          byCase.get(tag)?.push({ title: spec.title, status: test.status, annotations: test.annotations });
        }
      }
    }
    (suite.suites ?? []).forEach(walk);
  };
  results.suites.forEach(walk);
  /** @type {RunStats} */
  const stats = results.stats;

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
    if (id === 'GEN-04') {
      const ids = ['SEC-08', 'SEC-09', 'SEC-10', 'SEC-11', 'OTH-01', 'OTH-02', 'CNT-14', 'CNT-15', 'SHR-04'];
      const sub = ids.flatMap((x) => byCase.get(x) ?? []);
      const ok = sub.filter((t) => t.status === 'expected').length;
      return { status: ok === sub.length ? 'pass' : 'fail', tests: `${ok}/${sub.length}`, note: `по кейсам ${ids.join(', ')}` };
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
    const skipped = tests.filter((t) => t.status === 'skipped');
    if (skipped.length) {
      const reasons = [...new Set(skipped.flatMap((t) => t.annotations.filter((a) => a.type === 'skip').map((a) => a.description ?? '')))];
      return { status: 'skip', tests: count, note: esc(reasons.join('; ')) };
    }
    const findings = [
      ...new Set(tests.flatMap((t) => t.annotations.filter((a) => a.type === 'known-issue').map((a) => findingOf(a.description ?? '')))),
    ];
    if (/\*\*(BUG|DOCS BUG)/.test(row.Title)) {
      const finding = row.Title.match(/\*\*\[([A-Z]\d)\]\*\*/)?.[1] ?? findings[0];
      return { status: 'bug', tests: count, note: `баг воспроизводится${finding ? ` — <a href="#${finding}">${finding}</a>` : ''}` };
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
