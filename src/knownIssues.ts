import type { ErrorObject } from 'ajv';

/**
 * A schema mismatch the live API is known to have. `expectResponse` tolerates the
 * errors it explains and reports them, so one bug doesn't fail every test touching that
 * response. Its own "(known API bug)" test turns red once it's fixed: then delete it here.
 */
export interface KnownSchemaIssue {
  id: string;
  /** What the server does and what the spec says instead, one line for the report. */
  summary: string;
  /** Operations it shows up in; omitted for "any operation". */
  operations?: string[];
  explains(error: ErrorObject): boolean;
  /** Left out of the report's "Known issues" when it hits almost every test, so it doesn't bury the rest. */
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
 * Documented response headers the server never sends: `ETag` (19 responses, staging
 * and production; pinned by tests/other/caching.spec.ts). Kept out of the report, since
 * almost every 200 would list it.
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
