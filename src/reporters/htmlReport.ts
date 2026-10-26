import { mkdirSync, writeFileSync } from 'node:fs';
import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import {
  LIST_ONLY,
  collectRunSummary,
  describeTargets,
  formatRunError,
  lastAttemptErrors,
  lastAttemptStdout,
  lastAttemptTracePath,
  runVerdict,
  skippedByReason,
  traceHasSessionCookies,
} from './runSummary';

const TONE_COLORS = { ok: '#1e7e34', warn: '#b06a00', bad: '#b02a2a' } as const;

const OUT_PATH = 'test-results/latest.html';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * One self-contained HTML page for the latest run only, overwritten each time. A
 * status banner (see `runVerdict`), errors outside tests, then one card per failed
 * test: error, snippet, stdout, trace path. Passing tests are just a count, except
 * those with a `known-issue` annotation.
 */
export default class HtmlReporter implements Reporter {
  private startedAt = new Date();
  private rootSuite!: Suite;
  private runErrors: TestError[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = new Date();
    this.rootSuite = suite;
  }

  onError(error: TestError): void {
    this.runErrors.push(error);
  }

  onEnd(result: FullResult): void {
    // Keep the last run's report: `--list` runs nothing.
    if (LIST_ONLY) return;
    const summary = collectRunSummary(this.rootSuite, this.startedAt);
    const { tests, passed, skippedTests, notRun, flaky, failures, knownIssues, durationSec } = summary;
    const verdict = runVerdict(summary, result.status, this.runErrors.length);
    const runErrorsHtml = this.runErrors.length
      ? `<h2 class="section-title section-errors">Errors outside tests — e.g. a spec file that failed to load</h2>` +
        this.runErrors.map((error) => `<div class="card"><pre>${escapeHtml(formatRunError(error))}</pre></div>`).join('\n')
      : '';

    const knownIssueCards = knownIssues
      .map(
        ({ test, description }) => `
    <div class="card card-known">
      <div class="card-title">⚠ ${escapeHtml(test.titlePath().slice(1).join(' › '))}</div>
      <div class="card-loc">${escapeHtml(test.location.file)}:${test.location.line}</div>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    </div>`,
      )
      .join('\n');
    const knownIssuesHtml = knownIssues.length
      ? `<h2 class="section-title">Known issues — passed, but hit a documented product problem</h2>${knownIssueCards}`
      : '';
    const skippedHtml = skippedTests.length
      ? `<h2 class="section-title section-skipped">Skipped (${skippedTests.length})</h2><ul class="skipped">` +
        skippedByReason(skippedTests)
          .map(
            ({ reason, tests: group }) =>
              `<li><span class="skipped-reason">${escapeHtml(reason)}</span><ul>` +
              group.map((test) => `<li class="skipped-title">${escapeHtml(test.titlePath().slice(1).join(' › '))}</li>`).join('') +
              '</ul></li>',
          )
          .join('\n') +
        '</ul>'
      : '';

    const statusColor = TONE_COLORS[verdict.tone];
    const startedLabel = this.startedAt.toLocaleString();

    const cards = failures
      .map((test) => {
        const errorsHtml = lastAttemptErrors(test)
          .map((e) => `<pre>${escapeHtml([e.message, e.snippet].filter(Boolean).join('\n\n'))}</pre>`)
          .join('\n');

        const stdout = lastAttemptStdout(test);
        const stdoutHtml = stdout.trim()
          ? `<div class="section-label">stdout</div><pre>${escapeHtml(stdout.trimEnd())}</pre>`
          : '';

        const tracePath = lastAttemptTracePath(test);
        const traceWarning = traceHasSessionCookies(test)
          ? `<div class="trace-warning">⚠ This trace records the logged-in session's cookies — don't share or attach it.</div>`
          : '';
        const traceHtml = tracePath
          ? `<div class="trace">Trace: <code>npx playwright show-trace ${escapeHtml(tracePath)}</code>${traceWarning}</div>`
          : '';

        return `
    <div class="card">
      <div class="card-title">✘ ${escapeHtml(test.titlePath().slice(1).join(' › '))}</div>
      <div class="card-loc">${escapeHtml(test.location.file)}:${test.location.line}</div>
      ${errorsHtml || '<p><em>(no error details captured)</em></p>'}
      ${stdoutHtml}
      ${traceHtml}
    </div>`;
      })
      .join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test run — ${startedLabel}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #f5f5f5; color: #222; }
  .banner { background: ${statusColor}; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 20px; }
  .banner h1 { margin: 0 0 4px; font-size: 1.4em; }
  .banner .meta { opacity: 0.9; font-size: 0.95em; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
  .stat { flex: 1; min-width: 100px; background: white; border-radius: 8px; padding: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .stat-num { font-size: 3em; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 0.85em; color: #666; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
  .stat-total .stat-num { color: #222; }
  .stat-pass .stat-num { color: #1e7e34; }
  .stat-skip .stat-num { color: #8a6d00; }
  .stat-flaky .stat-num { color: #b06a00; }
  .stat-fail .stat-num { color: #b02a2a; }
  .stat-known .stat-num { color: #b06a00; }
  .card { background: white; border-left: 4px solid ${statusColor}; border-radius: 6px; padding: 14px 18px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card-known { border-left-color: #b06a00; }
  .section-title { font-size: 1.05em; margin: 24px 0 12px; color: #b06a00; }
  .card-title { font-weight: 600; margin-bottom: 4px; }
  .card-loc { color: #666; font-size: 0.85em; margin-bottom: 8px; font-family: monospace; }
  .section-label { color: #666; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 10px; }
  .trace { margin-top: 10px; font-size: 0.85em; color: #444; }
  .trace code { background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 2px 6px; }
  .trace-warning { margin-top: 6px; color: #b06a00; font-weight: 600; }
  pre { background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 10px; overflow-x: auto; font-size: 0.85em; white-space: pre-wrap; margin: 8px 0; }
  .empty { color: #1e7e34; font-weight: 600; }
  .section-errors { color: #b02a2a; }
  .section-skipped { color: #8a6d00; }
  .skipped { background: white; border-radius: 6px; padding: 10px 18px 10px 36px; margin: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .skipped li { margin: 6px 0; }
  .skipped-reason { color: #444; font-size: 0.9em; font-weight: 600; }
  .skipped-title { font-size: 0.85em; color: #666; }
</style>
</head>
<body>
  <div class="banner">
    <h1>${escapeHtml(verdict.text)}</h1>
    <div class="meta">${startedLabel} · ${escapeHtml(describeTargets(this.rootSuite))} · ${durationSec}s</div>
  </div>
  <div class="stats">
    <div class="stat stat-total"><div class="stat-num">${tests.length}</div><div class="stat-label">tests</div></div>
    <div class="stat stat-pass"><div class="stat-num">${passed}</div><div class="stat-label">passed</div></div>
    <div class="stat stat-skip"><div class="stat-num">${skippedTests.length}</div><div class="stat-label">skipped</div></div>
    ${flaky > 0 ? `<div class="stat stat-flaky"><div class="stat-num">${flaky}</div><div class="stat-label">flaky</div></div>` : ''}
    <div class="stat stat-fail"><div class="stat-num">${failures.length}</div><div class="stat-label">failed</div></div>
    ${notRun > 0 ? `<div class="stat stat-fail"><div class="stat-num">${notRun}</div><div class="stat-label">never ran</div></div>` : ''}
    ${knownIssues.length > 0 ? `<div class="stat stat-known"><div class="stat-num">${knownIssues.length}</div><div class="stat-label">known issues</div></div>` : ''}
  </div>
  ${runErrorsHtml}
  ${verdict.tone === 'ok' ? '<p class="empty">No failures. ✅</p>' : cards}
  ${knownIssuesHtml}
  ${skippedHtml}
</body>
</html>
`;

    mkdirSync('test-results', { recursive: true });
    writeFileSync(OUT_PATH, html, 'utf8');
    console.log(`\nHTML report: ${OUT_PATH}`);
  }
}
