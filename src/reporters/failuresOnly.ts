import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import {
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

/**
 * Minimal reporter for local runs: prints the run's start time and a pass/fail/skip
 * summary, then full detail ONLY for tests that actually failed — no per-passing-test
 * noise, apart from one line per passing test that recorded a `known-issue`
 * annotation. Errors outside any test (a spec file that fails to load, a crashed
 * worker) are printed too, and a run that was interrupted, timed out or had every
 * test skipped never ends with "No failures." (see `runVerdict`). Pairs with
 * `./htmlReport.ts` (same failure data, rendered as a static page);
 * neither replaces `use.trace` — a failed test's trace.zip is still written, and its
 * path is printed below so it stays inspectable via `playwright show-trace`.
 */
export default class FailuresOnlyReporter implements Reporter {
  private startedAt = new Date();
  private rootSuite!: Suite;
  private runErrors: TestError[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = new Date();
    this.rootSuite = suite;
    console.log(`\nRun started: ${this.startedAt.toLocaleString()} (${describeTargets(suite)})`);
  }

  onError(error: TestError): void {
    this.runErrors.push(error);
  }

  onEnd(result: FullResult): void {
    const summary = collectRunSummary(this.rootSuite, this.startedAt);
    const { tests, passed, skippedTests, notRun, flaky, failures, knownIssues, durationSec } = summary;
    const verdict = runVerdict(summary, result.status, this.runErrors.length);

    console.log(
      `${tests.length} tests — ${passed} passed, ${skippedTests.length} skipped, ${failures.length} failed` +
        (notRun > 0 ? `, ${notRun} never ran` : '') +
        (flaky > 0 ? `, ${flaky} flaky` : '') +
        (knownIssues.length > 0 ? `, ${knownIssues.length} known issue(s)` : '') +
        ` (${durationSec}s)\n`,
    );

    if (this.runErrors.length > 0) {
      console.log(`ERRORS OUTSIDE TESTS (${this.runErrors.length}) — e.g. a spec file that failed to load:`);
      for (const error of this.runErrors) {
        console.log(`\n${'='.repeat(80)}`);
        for (const line of formatRunError(error).split('\n')) console.log(`  ${line}`);
      }
      console.log(`${'='.repeat(80)}\n`);
    }

    if (knownIssues.length > 0) {
      console.log(`KNOWN ISSUES — passed, but hit a documented product problem (${knownIssues.length}):`);
      for (const { test, description } of knownIssues) {
        console.log(`  ⚠ ${test.titlePath().slice(1).join(' › ')}`);
        if (description) console.log(`    ${description}`);
      }
      console.log('');
    }

    if (skippedTests.length > 0) {
      console.log(`SKIPPED (${skippedTests.length}):`);
      for (const { reason, tests: group } of skippedByReason(skippedTests)) {
        console.log(`  ${reason}`);
        for (const test of group) console.log(`    - ${test.titlePath().slice(1).join(' › ')}`);
      }
      console.log('');
    }

    if (failures.length === 0) {
      console.log(verdict.tone === 'ok' ? 'No failures.' : verdict.text);
      return;
    }

    console.log(`${verdict.text}:`);
    for (const test of failures) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✘ ${test.titlePath().slice(1).join(' › ')}`);
      console.log(`  ${test.location.file}:${test.location.line}\n`);

      const errors = lastAttemptErrors(test);
      if (errors.length === 0) console.log('  (no error details captured)');
      errors.forEach(({ message, snippet }, i) => {
        if (i > 0) console.log('');
        if (message) for (const line of message.split('\n')) console.log(`  ${line}`);
        if (snippet) {
          console.log('');
          for (const line of snippet.split('\n')) console.log(`  ${line}`);
        }
      });

      const stdout = lastAttemptStdout(test);
      if (stdout.trim()) {
        console.log('\n  stdout:');
        for (const line of stdout.trimEnd().split('\n')) console.log(`  ${line}`);
      }

      const tracePath = lastAttemptTracePath(test);
      if (tracePath) {
        console.log(`\n  Trace: npx playwright show-trace ${tracePath}`);
        if (traceHasSessionCookies(test)) {
          console.log(`  ⚠ This trace records the logged-in session's cookies — don't share or attach it.`);
        }
      }
    }
    console.log(`${'='.repeat(80)}\n`);
  }
}
