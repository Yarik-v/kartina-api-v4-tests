import type { APIResponse } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { KNOWN_ISSUE_ANNOTATION } from './reporters/runSummary';
import { KNOWN_MISSING_HEADERS, knownIssue, knownIssueFor } from './knownIssues';
import { checkResponse, documentedHeaders, formatSchemaErrors } from './spec';
import type { ApiError } from './types';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Parsed JSON body, `null` for an empty one, the raw text if it isn't JSON. */
export async function readBody(res: APIResponse): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function excerpt(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** Lists a known product problem in the report, once per test, even when the test passes. */
export function recordKnownIssue(description: string): void {
  const { annotations } = test.info();
  if (!annotations.some((a) => a.type === KNOWN_ISSUE_ANNOTATION && a.description === description)) {
    annotations.push({ type: KNOWN_ISSUE_ANNOTATION, description });
  }
}

/**
 * Every header `operationId` documents for the response's status is present, and
 * the `X-Api-*` ones hold what the spec says they do.
 */
export function expectDocumentedHeaders(res: APIResponse, operationId: string): void {
  const headers = res.headers();
  for (const name of documentedHeaders(operationId, res.status())) {
    const key = name.toLowerCase();
    if (KNOWN_MISSING_HEADERS.includes(key)) continue;
    expect(headers[key], `${operationId} ${res.status()}: documented ${name} header`).toBeDefined();
  }
  if ('x-api-version' in headers) expect(headers['x-api-version'], 'X-Api-Version').toBe('4');
  if ('x-api-servertime' in headers) expect(Number(headers['x-api-servertime']), 'X-Api-Servertime').toBeGreaterThan(0);
  if ('x-api-messages' in headers) expect(Number(headers['x-api-messages']), 'X-Api-Messages').toBeGreaterThanOrEqual(0);
}

/**
 * Asserts `res` has `status` and matches what `operationId` documents for it: headers,
 * media type, schema. Schema errors a known bug explains (src/knownIssues.ts) are
 * tolerated and reported. Returns the parsed body (`null` when there's none).
 */
export async function expectResponse<T = unknown>(res: APIResponse, operationId: string, status: number): Promise<T> {
  const body = await readBody(res);
  expect(res.status(), `${operationId}: HTTP status (body: ${excerpt(body)})`).toBe(status);
  expectDocumentedHeaders(res, operationId);

  const { problem, errors } = checkResponse(operationId, status, res.headers()['content-type'] ?? '', body);
  expect(problem, `${operationId} ${status}`).toBeUndefined();

  const unexplained = errors.filter((error) => {
    const issue = knownIssueFor(operationId, error);
    if (issue && !issue.quiet) recordKnownIssue(`${issue.id}: ${issue.summary}`);
    return !issue;
  });
  expect(
    unexplained.length === 0,
    `${operationId} ${status} doesn't match its documented schema:\n${formatSchemaErrors(unexplained)}`,
  ).toBe(true);
  return body as T;
}

/**
 * `expectResponse` for an error, plus the `X-Api-Error-*` headers mirroring the body
 * and a UUID v7 `request_id`. `type` (e.g. `E_AUTH_ERROR`) pins the exact error.
 */
export async function expectError(res: APIResponse, operationId: string, status: number, type?: string): Promise<ApiError> {
  const body = await expectResponse<ApiError>(res, operationId, status);
  const headers = res.headers();
  expect(headers['x-api-error-code'], 'X-Api-Error-Code mirrors error.code').toBe(String(body.error.code));
  expect(headers['x-api-error-message'], 'X-Api-Error-Message header').toBeTruthy();
  expect(body.error.request_id, 'error.request_id is a UUID v7').toMatch(UUID_V7);
  if (type) expect(body.error.type, `error.type (${body.error.details.description})`).toBe(type);
  return body;
}

/**
 * Asserts a known schema bug still reproduces in `res`. Once it's fixed this fails:
 * then drop the src/knownIssues.ts entry and flip the test.
 */
export async function expectKnownIssue(res: APIResponse, operationId: string, status: number, issueId: string): Promise<void> {
  const issue = knownIssue(issueId);
  const body = await readBody(res);
  expect(res.status(), `${operationId}: HTTP status`).toBe(status);
  const { problem, errors } = checkResponse(operationId, status, res.headers()['content-type'] ?? '', body);
  expect(problem, `${operationId}: response to check for ${issueId}`).toBeUndefined();
  expect(
    errors.some((error) => issue.explains(error)),
    `${issueId} no longer reproduces: remove it from src/knownIssues.ts along with this test`,
  ).toBe(true);
  recordKnownIssue(`${issue.id}: ${issue.summary}`);
}
