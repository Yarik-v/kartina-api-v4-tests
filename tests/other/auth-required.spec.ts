import { test } from '../fixtures';
import { expectError } from '../../src/assertions';
import { allOperations, type Operation } from '../../src/spec';

/** The operation's path with every path parameter filled from the spec's own example (or first enum value). */
function examplePath(op: Operation): string {
  return op.path.slice(1).replace(/\{(\w+)\}/g, (_, name: string) => {
    const param = op.parameters.find((p) => p.in === 'path' && p.name === name);
    const value = param?.example ?? param?.schema?.example ?? param?.schema?.enum?.[0] ?? '1';
    return encodeURIComponent(String(value));
  });
}

// Every operation that needs a session, called without one, must answer the
// documented 403 E_AUTH_ERROR. Safe for the operations the suite otherwise never
// calls (sending sharing codes, changing the protect code, clearing the history...):
// without a session the server must refuse before doing anything, and no body is sent.
test.describe('every operation that needs a session refuses an anonymous caller', { tag: '@no-session' }, () => {
  for (const op of allOperations().filter((candidate) => candidate.requiresSession)) {
    test(`${op.method.toUpperCase()} ${op.path} (${op.id}) answers 403 E_AUTH_ERROR`, { tag: '@GEN-03' }, async ({ anonApi }) => {
      await expectError(await anonApi.raw(op.method.toUpperCase(), examplePath(op)), op.id, 403, 'E_AUTH_ERROR');
    });
  }
});
