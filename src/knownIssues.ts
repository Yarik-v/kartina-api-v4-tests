import type { ErrorObject } from 'ajv';

/**
 * A schema mismatch the live API is known to have. `expectResponse` tolerates the
 * errors an issue explains (and lists the issue in the report), so one known bug
 * doesn't fail every test that happens to touch the same response. Each issue also
 * has its own test, marked "(known API bug)", that asserts the bug still reproduces:
 * a fix turns that test red, and that's the cue to delete the entry here.
 */
export interface KnownSchemaIssue {
  id: string;
  /** What the server does and what the spec says instead, one line for the report. */
  summary: string;
  /** Operations it shows up in; omitted for "any operation". */
  operations?: string[];
  explains(error: ErrorObject): boolean;
  /**
   * Leave the issue out of the report's "Known issues" list when it shows up in
   * almost every test (its own test still pins it), so it doesn't bury the rest.
   */
  quiet?: boolean;
}

export const KNOWN_SCHEMA_ISSUES: KnownSchemaIssue[] = [
  {
    id: 'staging-debug-trace',
    summary:
      'Staging error bodies carry an `exception` key with the Symfony debug trace (server paths, class names) next to `error`; the error envelope allows no other key.',
    explains: (e) => e.instancePath === '' && e.keyword === 'additionalProperties' && e.params.additionalProperty === 'exception',
    quiet: true,
  },
  {
    id: 'search-url-template-format',
    summary:
      '`search_url` is a URI template (`?query={query}`), as the spec examples show, but the spec declares it `format: uri-reference`, which braces violate.',
    operations: ['getSearchHistory', 'searchServicesGenres', 'searchServicesCountries'],
    explains: (e) => e.instancePath === '/search_url' && e.keyword === 'format',
  },
  {
    id: 'radio-play-link-title',
    summary: 'GET /radio: `_links.play` of the stations has no `title`, which the `link` schema requires.',
    operations: ['GET /radio'],
    explains: (e) =>
      /^\/data\/\d+\/_links\/play$/.test(e.instancePath) && e.keyword === 'required' && e.params.missingProperty === 'title',
  },
  {
    id: 'radio-null-description',
    summary: 'GET /radio: some stations have `description: null`; the schema types it as a plain string.',
    operations: ['GET /radio'],
    explains: (e) => /^\/data\/\d+\/description$/.test(e.instancePath) && e.keyword === 'type',
  },
  {
    id: 'radio-group-channel-kind',
    summary: 'GET /pages/radio/channel-group: some stations come with `kind: "channel"`; `radioCard.kind` is the constant "radio".',
    operations: ['getRadioChannelGroupBlock'],
    explains: (e) => /^\/items\/\d+\/kind$/.test(e.instancePath) && e.keyword === 'const',
  },
];

/**
 * Documented response headers the server never sends. `ETag` is documented on 19
 * responses (with `304` for `If-None-Match`), but no response carries it, on
 * staging or production; pinned by tests/other/caching.spec.ts. Kept out of the
 * report like `staging-debug-trace`: almost every 200 would list it.
 */
export const KNOWN_MISSING_HEADERS = ['etag'];

/** The known issue that explains `error` in a response of `operationId`, if any. */
export function knownIssueFor(operationId: string, error: ErrorObject): KnownSchemaIssue | undefined {
  return KNOWN_SCHEMA_ISSUES.find(
    (issue) => (!issue.operations || issue.operations.includes(operationId)) && issue.explains(error),
  );
}

export function knownIssue(id: string): KnownSchemaIssue {
  const issue = KNOWN_SCHEMA_ISSUES.find((candidate) => candidate.id === id);
  if (!issue) throw new Error(`No known issue "${id}"`);
  return issue;
}
