import { stripVTControlCharacters } from 'node:util';
import type { FullResult, Suite, TestCase, TestError } from '@playwright/test/reporter';

/**
 * Annotation type a test pushes onto `test.info().annotations` when it passes but
 * observed a real, documented product problem it deliberately tolerates. Both
 * reporters list these even on an all-green run, since they otherwise only show
 * failures and the problem would be invisible.
 */
export const KNOWN_ISSUE_ANNOTATION = 'known-issue';

export interface KnownIssue {
  test: TestCase;
  description: string;
}

export interface SkippedTest {
  test: TestCase;
  /** The `test.skip(condition, reason)` text, or '' if the skip gave none. */
  reason: string;
}

export interface RunSummary {
  tests: TestCase[];
  passed: number;
  /**
   * Tests that ran and skipped themselves (no matching live data, no session, ...),
   * with the reason each one gave, so the report can say why.
   */
  skippedTests: SkippedTest[];
  /**
   * Tests that never started (the run was interrupted, timed out or stopped by
   * --max-failures). Playwright reports these as 'skipped' too, but unlike a real
   * skip they have no result at all, so they're counted apart.
   */
  notRun: number;
  flaky: number;
  failures: TestCase[];
  knownIssues: KnownIssue[];
  durationSec: string;
}

/**
 * The setup and teardown projects: a project that names a `teardown`, and that
 * teardown. Their tests open and close the session and check nothing, so they never
 * count as passed or skipped (a run whose only real test skipped must not read as
 * green). Their failures still count.
 */
function infrastructureProjects(rootSuite: Suite): Set<string> {
  const names = new Set<string>();
  for (const projectSuite of rootSuite.suites) {
    const project = projectSuite.project();
    if (project?.teardown) names.add(project.name).add(project.teardown);
  }
  return names;
}

/**
 * Buckets every test in `rootSuite` by outcome, relative to `startedAt`. Shared by
 * every reporter in this directory so they can never disagree on counts or on which
 * tests count as failures.
 */
export function collectRunSummary(rootSuite: Suite, startedAt: Date): RunSummary {
  const infrastructure = infrastructureProjects(rootSuite);
  const tests = rootSuite
    .allTests()
    .filter((test) => test.outcome() === 'unexpected' || !infrastructure.has(test.parent.project()?.name ?? ''));
  const durationSec = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);

  let passed = 0;
  let notRun = 0;
  let flaky = 0;
  const failures: TestCase[] = [];
  const knownIssues: KnownIssue[] = [];
  const skippedTests: SkippedTest[] = [];

  for (const test of tests) {
    switch (test.outcome()) {
      case 'skipped':
        // Only a test that skipped itself (test.skip / fixme) expects 'skipped'. Any
        // other skipped outcome never got to run: its project's dependency failed (no
        // results), a beforeAll or the worker failed (a 'skipped' result), or the run
        // was cut short (an 'interrupted' result).
        if (test.expectedStatus !== 'skipped') {
          notRun++;
        } else {
          const skip = test.annotations.find(({ type }) => type === 'skip' || type === 'fixme');
          skippedTests.push({ test, reason: skip?.description ?? '' });
        }
        break;
      case 'expected':
        passed++;
        break;
      case 'flaky':
        flaky++;
        break;
      default:
        failures.push(test);
        continue;
    }
    for (const { type, description } of test.annotations) {
      if (type === KNOWN_ISSUE_ANNOTATION) knownIssues.push({ test, description: description ?? '' });
    }
  }

  return { tests, passed, skippedTests, notRun, flaky, failures, knownIssues, durationSec };
}

/**
 * Skipped tests grouped by their reason, in first-seen order: a mass skip with
 * one cause (e.g. every test that needs a session, with no credentials) reads as that one cause
 * followed by its tests, not 17 copies of the same line.
 */
export function skippedByReason(skippedTests: SkippedTest[]): Array<{ reason: string; tests: TestCase[] }> {
  const groups = new Map<string, TestCase[]>();
  for (const { test, reason } of skippedTests) {
    const key = reason || '(no reason given)';
    groups.set(key, [...(groups.get(key) ?? []), test]);
  }
  return [...groups].map(([reason, tests]) => ({ reason, tests }));
}

export interface RunVerdict {
  text: string;
  tone: 'ok' | 'warn' | 'bad';
}

/**
 * The one-line verdict both reporters lead with. "No test failed" isn't enough:
 * a spec file that fails to load stops Playwright from running anything
 * (confirmed: 0 tests, exit code 1), an interrupted or timed-out run leaves
 * tests unrun, and an all-skipped run verifies nothing. None of those may read
 * as green.
 */
export function runVerdict(summary: RunSummary, status: FullResult['status'], errorCount: number): RunVerdict {
  const cutShort = status === 'interrupted' ? 'RUN INTERRUPTED' : status === 'timedout' ? 'RUN TIMED OUT' : '';
  if (summary.failures.length > 0) {
    // Failures alone would hide that the run stopped early with tests still unrun.
    const notRun = summary.notRun > 0 ? `, ${summary.notRun} never ran` : '';
    const suffix = cutShort ? ` — ${cutShort.toLowerCase()}${notRun}` : notRun;
    return { text: `${summary.failures.length} FAILED${suffix}`, tone: 'bad' };
  }
  if (cutShort) return { text: summary.notRun > 0 ? `${cutShort} — ${summary.notRun} never ran` : cutShort, tone: 'bad' };
  if (status !== 'passed' || errorCount > 0) return { text: 'RUN FAILED — errors outside tests', tone: 'bad' };
  if (summary.passed + summary.flaky === 0) return { text: 'NOTHING PASSED — every test was skipped', tone: 'warn' };
  return { text: 'ALL PASSED', tone: 'ok' };
}

/** An error raised outside any test (e.g. a spec file that fails to load), ANSI stripped. */
export function formatRunError(error: TestError): string {
  const text = [error.stack ?? error.message ?? error.value ?? 'unknown error', error.snippet].filter(Boolean).join('\n\n');
  return stripVTControlCharacters(text);
}

/** The last attempt's errors, message + code-frame snippet, ANSI stripped. Never truncated. */
export function lastAttemptErrors(test: TestCase): Array<{ message?: string; snippet?: string }> {
  const lastResult = test.results[test.results.length - 1];
  return (lastResult?.errors ?? []).map((error) => ({
    message: error.message ? stripVTControlCharacters(error.message) : undefined,
    snippet: error.snippet ? stripVTControlCharacters(error.snippet) : undefined,
  }));
}

/** The last attempt's captured stdout, concatenated to one string (empty if none). */
export function lastAttemptStdout(test: TestCase): string {
  const lastResult = test.results[test.results.length - 1];
  return lastResult?.stdout.map((chunk) => chunk.toString()).join('') ?? '';
}

/** Path to the last attempt's trace.zip, if `use.trace` recorded one. */
export function lastAttemptTracePath(test: TestCase): string | undefined {
  const lastResult = test.results[test.results.length - 1];
  return lastResult?.attachments.find((a) => a.name === 'trace')?.path;
}

/**
 * Whether the test's project runs with a saved login (`use.storageState`). Its
 * traces then record that session's MW_SSID cookie in the network log, on every
 * request. Playwright can't leave the network log out of a trace, so reporters
 * warn next to the trace path instead.
 */
export function traceHasSessionCookies(test: TestCase): boolean {
  return Boolean(test.parent.project()?.use.storageState);
}

/**
 * "api-v4-setup: rustvt.kartina.tv · api-v4: rustvt.kartina.tv": one
 * entry per project that actually has tests in this run, from its own `baseURL`.
 */
export function describeTargets(rootSuite: Suite): string {
  const targets = rootSuite.suites
    .filter((projectSuite) => projectSuite.allTests().length > 0)
    .map((projectSuite) => {
      const project = projectSuite.project();
      const baseURL = project?.use.baseURL;
      // A malformed V4_API_HOST is reported by the project's own
      // fixtures; here it's just shown as-is rather than crashing the reporter.
      const target = !baseURL ? 'no baseURL' : URL.canParse(baseURL) ? new URL(baseURL).host : baseURL;
      return `${project?.name}: ${target}`;
    });
  return targets.length > 0 ? targets.join(' · ') : 'no tests collected';
}
