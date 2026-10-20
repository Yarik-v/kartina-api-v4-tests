# Kartina.TV API v4 — Playwright test suite

HTTP-only Playwright tests (no browser) for the subscriber
[middleware API v4](https://pages.kartina.tv/middleware/docs/v4/), logged in as a real
account. Default target: the staging host `https://rustvt.kartina.tv/api/v4`.

## Setup

```bash
npm install
cp .env.example .env    # then fill in V4_LOGIN / V4_PASSWORD
```

Without `V4_LOGIN` / `V4_PASSWORD` every test that needs a session skips itself with
that reason, and only the `@no-session` ones run.

## Running

```bash
npm test               # the whole suite
npm run test:ui        # Playwright's UI mode
npm run report         # open the last HTML report
npm run typecheck      # tsc --noEmit
npm run spec:refresh   # re-download spec/openapi.yaml from the docs
```

`V4_API_HOST=iptv.kartina.tv` points the suite at production. It stays on staging for
now.

### Reading the report

Results go to the terminal and to `test-results/latest.html` (`npm run report`). Both
list only what needs attention: passing tests are just a count. The headline is
**ALL PASSED**, **NOTHING PASSED — every test was skipped** (e.g. no credentials),
**N FAILED** (each failure with its error, code snippet and trace path), or
**RUN FAILED / INTERRUPTED / TIMED OUT**. **Known issues** lists tests that passed but
hit a documented API bug (see below), **Skipped** groups every skip under its reason.

**Don't share traces.** A failed test keeps its `trace.zip`, and it records the
session cookie; a login test's trace also records the password.

## How it's organized

- `spec/openapi.yaml` — the published OpenAPI document, saved locally.
- `src/spec.ts` — finds an operation by `operationId` and validates a live response
  against what the spec documents for its status: headers, media type and body
  schema (via Ajv, `$ref`s to `components/responses` included).
- `src/assertions.ts` — `expectResponse(res, operationId, status)` and
  `expectError(res, operationId, status, type?)`, which every test calls.
  `expectError` also checks the `X-Api-Error-Code` / `X-Api-Error-Message` headers and
  the UUID v7 `request_id`.
- `src/client.ts` — a thin typed wrapper over Playwright's `APIRequestContext`, one
  method per operation, named after its `operationId`; methods return the raw
  `APIResponse` so tests assert on errors as well as successes.
- `src/knownIssues.ts` — the schema mismatches the live API is known to have.
- `src/types.ts` — response types for what the tests read.
- `TEST_CASES.md` — the test-case catalog: every case with its priority, expected
  result and the spec that automates it, or why it's a gap.
- `tests/` mirrors the doc's tag groups: `account/` (Security, Client, Profiles,
  Favorites, Sharing, Registration Prompt), `catalog/` (Channels, Content, Radio,
  Search, Services), `interface/` (Pages, Blocks) and `other/` (Other, plus checks that
  sweep the whole spec). All 70 operations are covered.
- `tests/fixtures.ts` — `api` (the shared session), `anonApi` / `newAnonApi` (no
  cookies), and worker-scoped live data fetched once per worker: `account`,
  `services`, `channels`, `dashboard`, `dashboardBlocks` (each loaded from its own
  `block_url`), `sampleMovie`, `sampleSeries`. Ids are discovered, never hardcoded;
  a test that needs data that isn't live right now skips itself.

### One session per run

`tests/auth.setup.ts` (project `api-v4-setup`) logs in once and saves the `MW_SSID`
cookie to `tests/.auth/session.json` (gitignored); every test and worker shares it
through `storageState`, and `tests/auth.teardown.ts` logs out at the end. Not one login
per worker, for two reasons found against the live API:

- a login ends the previous session of the same `serial`;
- the account keeps only 3 sessions at once: a 4th login pushes the oldest out (it
  answers `409 E_ANOTHER_CLIENT_IN` once, then `403`).

The suite holds at most two: the shared one (`V4_SERIAL`) and the one
`tests/account/security.spec.ts` opens and closes on `${V4_SERIAL}-aux`. Running it while
the account is in use on 2+ other devices can still push one of those out. The device
model must be one the server knows (`V4_DEVICE`, default `androidtv-yb-005`).

### The account is real: reversible changes only

- Settings (they belong to the suite's own device), profiles (prefixed `pw-`, cleaned
  up even after an interrupted run), VOD and channel favorites and hidden channels are
  changed and put back. Files that touch shared account state run in order
  (`mode: 'default'`).
- Never called: changing the protect code, `POST /sharing/code` / `POST /sharing/account`
  / `DELETE /sharing/friends/…` (they send codes or change the friend subscription),
  clearing the search history, answering the registration prompt. They're still
  covered by the anonymous 403 sweep. The search history only gets a repeat of its top
  query, which by the docs changes nothing.
- Wrong credentials use a login that can't exist, never a wrong password for the real
  account (a long number like `99999999999` can be someone else's account).
- `V4_PROTECT_CODE` (optional) enables the protect-code and hidden-channel tests;
  without it the suite never sends a protect code at all.

### Known API bugs are pinned, not skipped

`expectResponse` tolerates exactly the schema mismatches listed in
`src/knownIssues.ts` (and lists them under *Known issues* in the report). Each of them,
and each status-code bug, has its own test marked "(known API bug)" or
"(known docs bug)" that asserts it still reproduces, so a fix turns it red: then delete
the entry and flip the test to the documented behavior. Found so far (staging):

| Area | What the server does | Documented |
|------|----------------------|------------|
| Trailers | a made-up `trailerId` answers `200` (for some movies with the title's own stream) or `503` | `404 E_WRONG_ID` |
| Teleteka | a programme without a recording plays a stub clip (`200`) | `403 E_ARCHIVE_NOT_AVAILABLE` |
| Blocks | an unknown block answers `503` (`GET .../blocks/{id}` and `.../{link}`) | `404` |
| Search | `GET /search/services/countries` answers `503` | `200` |
| Caching | no response carries an `ETag`, so `304` never happens | ETag on 19 responses |
| Playback block | `limit=0` / `limit=101` answer `200` | 1–100, else `400` |
| Radio | `/radio` play links lack `title`, a station has `description: null`; channel-group stations have `kind: "channel"` | required `title`, string, `"radio"` |
| Sessions | an evicted session answers `409 E_ANOTHER_CLIENT_IN` | not documented (not automated: it would evict real devices) |
| Staging | every error body carries the Symfony `exception` trace (server paths, internal hosts) | `error` only |
| Docs | 4 examples break their own `format: uri-reference`; `/radio` ops have no `operationId`; the `{service}` enum of `GET /content/{service}/{id}` leaves out startru and iviru | — |

`tests/other/auth-required.spec.ts` calls every operation that needs a session without
one and expects `403 E_AUTH_ERROR`; `tests/other/spec-examples.spec.ts` checks every
documented example against its own schema.

## CI

`.github/workflows/typecheck.yml` runs `npm run typecheck` on every push/PR to `main`.
It doesn't run the suite: that needs a real subscriber login in repository secrets
and a network the API accepts. GitHub-hosted runners got `403` from every Kartina.TV
endpoint in the sibling Free API suite, and the v4 hosts probably sit behind the same
protection (not confirmed). `playwright.config.ts` already switches to the
`github`/`junit`/`html` reporters under `CI=true`, so a live-test job is just a job to add.
