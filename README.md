# Kartina.TV API v4 — Playwright tests

HTTP-only Playwright + TypeScript tests (no browser) for the subscriber
[middleware API v4](https://pages.kartina.tv/middleware/docs/v4/). They log in as a
**real account**, by default on staging (`rustvt.kartina.tv`). All 70 operations are
covered, and every response is validated against `spec/openapi.yaml`.

## Quick start

```bash
npm install
cp .env.example .env    # fill in V4_LOGIN and V4_PASSWORD
npm test
```

Without credentials only the `@no-session` tests run; the rest skip.

| Variable | Purpose |
|----------|---------|
| `V4_LOGIN`, `V4_PASSWORD` | the subscriber account |
| `V4_API_HOST` | `rustvt.kartina.tv` (staging, default) or `iptv.kartina.tv` (production) |
| `V4_PROTECT_CODE` | enables the protect-code and hidden-channel tests; without it no code is ever sent |
| `V4_ADMIN_CREATED_ACCOUNT=1` | the account comes from the admin panel: also checks it has a personal cabinet |
| `V4_DEVICE`, `V4_SERIAL` | a device model the server knows (default `androidtv-yb-005`) and the session serial |

## Commands

```bash
npm test               # the whole suite, browser tests included
npm run test:browser   # only the browser tests (web client on playtest.kartina.tv)
npm run test:ui        # Playwright UI mode
npm run report         # open the last report (test-results/latest.html)
npm run report:bugs    # bug report for the API developers: reports/<date>-api-v4-<env>.html
npm run typecheck      # the only check CI runs
npm run spec:refresh   # re-download spec/openapi.yaml
```

Every test is tagged with its `TEST_CASES.md` ID:

```bash
npx playwright test --grep @CNT-11
# an @mutates case, without running the read-only suite first:
V4_MUTATING_ONLY=1 npx playwright test --project=api-v4-mutating --grep @FAV-05
```

The report lists only what needs attention: failures (error, code, trace), *Known
issues* (passed, but hit a known API bug) and skips grouped by reason.

> **Don't share traces** of failed tests: they contain the session cookie, and for
> login tests the password.

## Layout

- `spec/openapi.yaml` — the contract. `src/spec.ts` and `src/assertions.ts`
  (`expectResponse`, `expectError`) check status, headers and body schema against it.
- `src/client.ts` — one method per operation; `src/knownIssues.ts` — tolerated schema bugs.
- `tests/` — `account/`, `catalog/`, `interface/`, `other/`, as grouped in the docs.
  `tests/fixtures.ts` provides the clients and live data: ids are discovered, never
  hardcoded, and a test skips if the data it needs isn't live.
- `ui-tests/` — browser tests of the web client at `playtest.kartina.tv`, which talks to
  this API on staging; `ui-tests/fixtures.ts` gives each test `uiApi`, API v4 on the
  browser's own session, to compare the UI with.
- `TEST_CASES.md` — the case catalog: ID, priority, expected result, the automating
  spec or why it's a gap.
- `scripts/bug-report/` — builds `reports/`: each finding with its raw requests and
  responses (password and tokens left out) and the result of every case. Finding
  texts live in `render.mjs`.

## Run order

1. **Setup** logs in once; every test shares that session, teardown logs out. One
   login only: a login ends the previous session of the same serial, and the account
   allows 3 sessions (a 4th evicts a real device). The suite holds at most two.
2. **`api-v4`** (read-only, 1 retry) and **`api-v4-pinned`** (known-bug tests) run in
   parallel.
3. **`api-v4-mutating`** (`@mutates`) runs next, one test at a time, and only if
   `api-v4` passed; otherwise the report shows its cases as "не запускался".
4. **`browser-setup`** logs in to the web client through its form, then **`browser-ui`**
   runs one test at a time (UI-05 changes the favorites, so it comes after
   `api-v4-mutating`) and **`browser-teardown`** logs out. The client can't reuse the API
   session: it re-logs in with the stored password on every page load, on its own serial,
   so the browser holds one session of its own (two with the API session, never more).

### Browser tests: what to know

- The client keeps the account's **password in plain text in localStorage**
  (`___kartina.tv.account`, field `pass`). So `tests/.auth/browser.json` holds it during
  a run (gitignored; the teardown empties it), and the browser projects record no
  traces: every page load also sends it in `POST /login`. Failures get a screenshot.
- With a wrong login the form shows no message at all: it just stays on `/login`.
- Every search in the client is POSTed to the account's search history, which can only
  be cleaned up by wiping it. UI-10 searches for the history's top query only.
- The client has no profiles UI, so profiles are covered by the API tests only.
- Only on staging: the client picks its API host from its own address.

## The account is real

- Only reversible changes: settings, profiles (named `pw-…`), favorites, hidden
  channels (only while the account hides none). A test registers its clean-up with
  `undo` *before* the change, so it runs even on failure or timeout. Negative tests
  that could do damage if the server wrongly accepted them are guarded the same way.
- Never done: changing the protect code (only requests that must be rejected are
  sent), `POST /sharing/code`, `POST /sharing/account`, `DELETE /sharing/friends/…`,
  clearing the search history, answering the registration prompt.
- Wrong-credential tests use a login that can't exist, never a wrong password for the
  real account.

## Known API bugs

Pinned, not skipped: each bug has a test marked "(known API bug)" that asserts it
still reproduces, so a fix turns it red. Then flip the test to the documented
behavior and drop the `src/knownIssues.ts` entry. Found on staging:

| Area | What the server does | Documented |
|------|----------------------|------------|
| Trailers | a made-up `trailerId` answers `200` (for some movies with the title's own stream) or `503` | `404 E_WRONG_ID` |
| Teleteka | a programme without a recording plays a stub clip (`200`); partly fixed by the 21.10.2026 deploy, some programmes now get the 403 | `403 E_ARCHIVE_NOT_AVAILABLE` |
| Blocks | an unknown block answers `503` (`GET .../blocks/{id}` and `.../{link}`) | `404` |
| Search | `GET /search/services/countries` answers `503` | `200` |
| Caching | no response carries an `ETag`, so `304` never happens | ETag on 19 responses |
| Playback block | `limit=0` / `limit=101` answer `200` | 1–100, else `400` |
| Radio | `/radio` play links lack `title`, a station has `description: null`; channel-group stations have `kind: "channel"` | required `title`, string, `"radio"` |
| Sessions | an evicted session answers `409 E_ANOTHER_CLIENT_IN` | not documented (not automated: it would evict real devices) |
| Staging | every error body carries the Symfony `exception` trace (server paths, internal hosts) | `error` only |
| Docs | 4 examples break their own `format: uri-reference`; `/radio` ops have no `operationId`; the `{service}` enum of `GET /content/{service}/{id}` leaves out startru and iviru | — |

## CI

`.github/workflows/typecheck.yml` runs only `npm run typecheck`. The suite itself
needs real credentials and a network the API accepts (GitHub runners were blocked in
the sibling Free API suite).
