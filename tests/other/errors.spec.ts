import { test, expect } from '../fixtures';
import { expectError, readBody, recordKnownIssue } from '../../src/assertions';
import { isStaging } from '../../src/config';

test.describe('error envelope', { tag: '@no-session' }, () => {
  test('errors are application/problem+json with the code mirrored in headers', async ({ anonApi }) => {
    const body = await expectError(await anonApi.getAccount(), 'getAccount', 403, 'E_AUTH_ERROR');
    expect(body.error.code).toBe(12);
  });

  test('error bodies carry no debug trace, except on staging (known API bug)', async ({ anonApi }) => {
    // The envelope allows `error` only. Staging adds `exception` with the Symfony
    // trace: class names, server paths, internal hosts (collections-dev...), plus
    // X-Debug-Token(-Link) headers on every response. The profiler they link to
    // isn't reachable from outside, but the trace is in every error body.
    // expectResponse tolerates it everywhere else (see `staging-debug-trace`).
    const res = await anonApi.getAccount();
    const body = (await readBody(res)) as Record<string, unknown>;
    if (!isStaging) {
      expect(body).not.toHaveProperty('exception');
      return;
    }
    expect(body, 'staging still leaks the debug trace').toHaveProperty('exception');
    expect(res.headers()['x-debug-token-link']).toBeTruthy();
    recordKnownIssue('staging-debug-trace: staging error bodies carry the Symfony `exception` trace and X-Debug-Token-Link headers');
  });
});
