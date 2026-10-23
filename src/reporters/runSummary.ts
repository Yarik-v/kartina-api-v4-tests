import { stripVTControlCharacters } from 'node:util';
import type { FullResult, Suite, TestCase, TestError } from '@playwright/test/reporter';

/**
 * Annotation a passing test adds when it tolerated a known product bug. Both reporters
 * list these even on a green run, where they would otherwise be invisible.
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
  /** Tests that skipped themselves, with the reason each gave. */
  skippedTests: SkippedTest[];
  /**
   * Tests that never started (interrupted, timed out, --max-failures). Playwright
   * calls them 'skipped' too, but they have no result, so they're counted apart.
   */
  notRun: number;
  flaky: number;
  failures: TestCase[];
  knownIssues: KnownIssue[];
  durationSec: string;
}

/**
 * The setup and teardown projects. They only open and close the session, so they never
 * count as passed or skipped (an all-skipped run must not read as green); their
 * failures still count.
 */
function infrastructureProjects(rootSuite: Suite): Set<string> {
  const names = new Set<string>();
  for (const projectSuite of rootSuite.suites) {
    const project = projectSuite.project();
    if (project?.teardown) names.add(project.name).add(project.teardown);
  }
  return names;
}

/** Buckets every test by outcome. Shared by the reporters here, so their counts agree. */
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
        // Only a self-skip (test.skip / fixme) expects 'skipped'. Any other skip never
        // ran: a failed dependency, beforeAll or worker, or a cut-short run.
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
 * Skipped tests grouped by reason, in first-seen order: a mass skip (e.g. no
 * credentials) reads as one cause, not dozens of identical lines.
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
 * The verdict both reporters lead with. "No failures" isn't enough: a spec that fails
 * to load runs nothing (0 tests, exit code 1), a cut-short run leaves tests unrun, and
 * an all-skipped run checks nothing. None of these may read as green.
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
 * Whether the project uses a saved login (`use.storageState`): its traces then record
 * the MW_SSID cookie on every request. Playwright can't leave the network log out of a
 * trace, so reporters warn next to the trace path.
 */
export function traceHasSessionCookies(test: TestCase): boolean {
  return Boolean(test.parent.project()?.use.storageState);
}

/** "api-v4: rustvt.kartina.tv · …": one entry per project with tests in this run. */
export function describeTargets(rootSuite: Suite): string {
  const targets = rootSuite.suites
    .filter((projectSuite) => projectSuite.allTests().length > 0)
    .map((projectSuite) => {
      const project = projectSuite.project();
      const baseURL = project?.use.baseURL;
      // A malformed V4_API_HOST is reported by the fixtures; here it's shown as is.
      const target = !baseURL ? 'no baseURL' : URL.canParse(baseURL) ? new URL(baseURL).host : baseURL;
      return `${project?.name}: ${target}`;
    });
  return targets.length > 0 ? targets.join(' · ') : 'no tests collected';
}
