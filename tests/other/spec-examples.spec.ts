import { test, expect } from '../fixtures';
import { recordKnownIssue } from '../../src/assertions';
import { allOperations, checkExample, documentedExamples, formatSchemaErrors } from '../../src/spec';

// The documentation's own examples have to satisfy the schemas they illustrate:
// a client generated from the schema would reject what the docs show it. No request
// is made, so these run without a session.

/**
 * Examples known to break their own schema, by `operationId status name`. Each
 * one's test asserts it's still broken; once the docs are fixed it fails, and the
 * entry should go.
 */
const KNOWN_INVALID: Record<string, string> = {
  'searchServices 200 example': '`next_url` holds unencoded Cyrillic, not a valid `format: uri-reference`',
  'searchServicesCountries 200 example': '`search_url` is a URI template (`{country}`), not a valid `format: uri-reference`',
  'searchServicesGenres 200 example': '`search_url` is a URI template (`{genre}`), not a valid `format: uri-reference`',
  'getSearchHistory 200 example': '`search_url` is a URI template (`{query}`), not a valid `format: uri-reference`',
};

test.describe('documented examples match their schemas', { tag: '@no-session' }, () => {
  for (const example of documentedExamples()) {
    const key = `${example.operationId} ${example.status} ${example.name}`;
    const knownProblem = KNOWN_INVALID[key];

    test(`${key}${knownProblem ? ' (known docs bug)' : ''}`, { tag: knownProblem ? '@GEN-09' : '@GEN-08' }, () => {
      const errors = checkExample(example);
      if (knownProblem) {
        expect(errors.length, `${key} is valid now: remove it from KNOWN_INVALID`).toBeGreaterThan(0);
        recordKnownIssue(`spec example ${key}: ${knownProblem}`);
      } else {
        expect(errors.length === 0, formatSchemaErrors(errors)).toBe(true);
      }
    });
  }
});

test('only the deprecated radio operations have no operationId (known docs gap)', { tag: ['@no-session', '@GEN-10'] }, () => {
  // Every other operation names itself; generated clients fall back to made-up names
  // for these two. Pinned: once they get ids this fails (and the suite can use them).
  const unnamed = allOperations().filter((op) => op.id === `${op.method.toUpperCase()} ${op.path}`);
  expect(unnamed.map((op) => op.id)).toEqual(['GET /radio', 'GET /radio/{id}']);
  recordKnownIssue('operation-ids: GET /radio and GET /radio/{id} have no operationId');
});
