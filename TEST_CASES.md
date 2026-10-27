# Test cases — Kartina.TV API v4

Manual test-case catalog for the [middleware API v4](https://pages.kartina.tv/middleware/docs/v4/)
(`https://rustvt.kartina.tv/api/v4`, staging), mirroring the doc's own tag groups
(Account, Catalog, Interface, Other). The **Automated** column points at the Playwright
spec that covers a case; `—` means it's a gap, with the reason next to it: either
the case would change the real account irreversibly or reach outside it (sending
codes, evicting devices), or it needs something a black-box client doesn't control
(geo, the operator's console, a mobile device, real viewing).

Legend: **P0** = blocks release if broken, **P1** = should work, **P2** = nice to have covered.
**BUG** / **DOCS BUG** = the live API (or the spec itself) contradicts the documentation;
the case pins the current behavior so that a fix turns its test red (see README,
"Known API bugs"). The bugs are written up for the developers, with the exact requests
and responses, in the report `npm run report:bugs` builds (`reports/<date>-api-v4-<env>.html`,
not kept in git); the **[A1]**-style tags in this catalog are that report's IDs.

**203 cases total, 180 automated, 23 gaps** (`—` in Automated); see "Remaining gaps"
at the end for the breakdown. Of the automated ones, 12 run only when their
precondition holds: 9 need `V4_PROTECT_CODE` and 1 `V4_ADMIN_CREATED_ACCOUNT` (both
set for the account in use, so they run), 2 need live data that isn't always there (they skip themselves otherwise; as of
20.10.2026 the dashboard has no non-playable title and no ivi / start_film block).

All cases run on one shared session of the account in `.env` unless the
Preconditions say "no session". Every test carries the ID of its case as a tag, so
`npx playwright test --grep @CNT-11` runs one case (for a case that changes the
account: `V4_MUTATING_ONLY=1 npx playwright test --project=api-v4-mutating --grep @FAV-05`),
and a run's results map onto this catalog case by case (the developer report has that
table). The ~15 cases that pin a known bug are also tagged `@pinned`.

## 1. Account

### 1.1 Security — `POST /login`, `POST /logout`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| SEC-01 | Login with valid credentials | P0 | no session; valid `V4_LOGIN` / `V4_PASSWORD` | POST `/login` with `login`, `password`, a known `device`, `serial` | 200; matches the documented schema; `login` equals `V4_LOGIN`; `expire_at` in the future; `services` / `settings` are `/api/v4/services` / `/api/v4/settings`; `packet.share_links` is null; `Set-Cookie: MW_SSID=<security>`; `X-Token` present and not equal to `security` | `tests/account/security.spec.ts` |
| SEC-02 | The new session authorizes requests | P0 | SEC-01 done | GET `/account` with the new cookie | 200; same `security`, `login` and `packet.id` as the login body | `tests/account/security.spec.ts` |
| SEC-03 | Optional `push_token` accepted | P2 | no session | SEC-01 plus `push_token` | 200 | `tests/account/security.spec.ts` |
| SEC-04 | One session per device and serial | P1 | no session | Log in twice with the same `device` + `serial` from two clients | Two different `security` values; the first session now answers 403 `E_AUTH_ERROR`, the second 200. Observed behavior, not in the spec | `tests/account/security.spec.ts` |
| SEC-05 | Logout ends the session, expires the cookie | P0 | a session of its own | POST `/logout` | 204, no body; `Set-Cookie: MW_SSID=deleted; … Max-Age=0`; GET `/account` then answers 403 `E_AUTH_ERROR` | `tests/account/security.spec.ts` |
| SEC-06 | A logged-out session id stays dead | P1 | SEC-05 done | Replay the old `MW_SSID` by hand on GET `/account` | 403 `E_AUTH_ERROR` | `tests/account/security.spec.ts` |
| SEC-07 | Logout without a session | P1 | no session | POST `/logout` | 403 `E_AUTH_ERROR` | `tests/account/security.spec.ts` |
| SEC-08 | Empty login body | P0 | no session | POST `/login` with `{}` | 400 `E_NEED_PARAM`; `details.description` names `login`, `password`, `device` and `serial` | `tests/account/security.spec.ts` |
| SEC-09 | One required field missing (×4) | P1 | no session | POST `/login` without `login` / `password` / `device` / `serial` in turn | 400 `E_NEED_PARAM`; the description names only the missing field | `tests/account/security.spec.ts` |
| SEC-10 | Unknown device model | P1 | no session | POST `/login` with a `device` the server doesn't know | 400 `E_NEED_PARAM`, `Device … not found.` (this text isn't among the spec's examples) | `tests/account/security.spec.ts` |
| SEC-11 | Unknown login | P0 | no session | POST `/login` with login `not-a-login` | 403 `E_INCORRECT_LOGIN`, `Incorrect login`; no session opened (GET `/account` 403) | `tests/account/security.spec.ts` |
| SEC-12 | Wrong password for an existing login | P1 | no session | POST `/login` with the real login and a wrong password | 403 `E_INCORRECT_LOGIN`, `Wrong password` | — (excluded: repeated runs could lock the real account) |
| SEC-13 | **Undocumented:** a 4th session evicts the oldest **[U1]** | P1 | 3 sessions of the account open | Log in from a 4th serial; call GET `/account` on the oldest session twice | First call 409 `E_ANOTHER_CLIENT_IN` ("Абонемент используется на другом устройстве"), then 403. The spec documents neither the limit nor the 409 | — (excluded: would knock the account's real devices out) |
| SEC-14 | `X-Client-Version` doesn't change the answer | P2 | no session | SEC-01 with `X-Client-Version: 20260517` | Same response as without it | `tests/account/security.spec.ts` |
| SEC-15 | `mirror` with geo-routing | P2 | a deployment with geo-routing | POST `/login` | Body carries `mirror` (alternative server) | — (needs a geo-routed deployment) |
| SEC-16 | The login body shows the prompt only without a personal cabinet | P1 | no session | SEC-01 | `registration_prompt.show == true` only together with `has_personal_account == false` (the `hasPersonalAccount` schema: "The prompt is shown only when false") | `tests/account/security.spec.ts` |

### 1.2 Client — `GET /account`, `GET`/`POST /settings`, protect code

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| CLI-01 | The account of the current session | P0 | none | GET `/account` | 200; schema; `login` equals `V4_LOGIN`; `security` is the session id the request used; `packet.share_links` is null or `/api/v4/sharing/link` (unlike the login body) | `tests/account/client.spec.ts` |
| CLI-02 | Settings are self-consistent | P0 | none | GET `/settings` | 200; schema; `standard`, `server`, `bitrate`, `caching`, `timeshift` each have a non-empty `allowed` that contains their `value`; `catchup` has `enabled` / `delay` / `length` | `tests/account/client.spec.ts` |
| CLI-03 | Change one setting | P0 | `server` allows more than one value | POST `/settings` `{name: "server", value: <another allowed>}`, then GET `/settings`; restore | 200 with all six settings, `server.value` changed; GET agrees; restored settings equal the original exactly | `tests/account/client.spec.ts` |
| CLI-04 | Changing `standard` recalculates the rest | P1 | `standard` allows more than one value | POST `{name: "standard", …}`; restore | 200; every choice still holds one of its own `allowed` values; afterwards everything (catchup included) is back as it was | `tests/account/client.spec.ts` |
| CLI-05 | Value outside `allowed` | P1 | none | POST `{name: "server", value: "playwright-no-such-server"}` | 400; `server` unchanged | `tests/account/client.spec.ts` |
| CLI-06 | Unknown setting name | P1 | none | POST `{name: "playwright", value: 1}` | 400 | `tests/account/client.spec.ts` |
| CLI-07 | Missing `value` | P2 | none | POST `{name: "server"}` | 400 | `tests/account/client.spec.ts` |
| CLI-08 | Settings belong to the device | P2 | two sessions on different devices | Change a setting on one, read it on the other | The other device's settings are unaffected | — (not automated: needs a second device session for the whole test) |
| CLI-09 | Protect-code check without a code | P1 | none | POST `/protect-code/check` `{}` | 400 | `tests/account/client.spec.ts` |
| CLI-10 | Protect-code check, right code | P1 | `V4_PROTECT_CODE` | POST `{code: <right>}` | 200 `{success: true}` | `tests/account/client.spec.ts` (needs `V4_PROTECT_CODE`) |
| CLI-11 | Protect-code check, wrong code | P1 | `V4_PROTECT_CODE` | POST `{code: <wrong>}` | 403 `E_CURRENT_PASS_BAD` | `tests/account/client.spec.ts` (needs `V4_PROTECT_CODE`) |
| CLI-12 | Protect-code change without parameters | P2 | `V4_PROTECT_CODE` (to check afterwards that it still works) | POST `/protect-code/change` `{}` | 400; nothing changes | `tests/account/client.spec.ts` (needs `V4_PROTECT_CODE`) |
| CLI-13 | Protect-code change, confirmation mismatch | P1 | `V4_PROTECT_CODE` | POST `{old: <right>, new: A, confirm: B}` | 400; nothing changes | `tests/account/client.spec.ts` (needs `V4_PROTECT_CODE`) |
| CLI-14 | Protect-code change succeeds | P1 | `V4_PROTECT_CODE` | Change old → new, check, change back | 200 each way; the new code works for `/check` | — (excluded: changes the account's parental code; a failure halfway would leave it changed) |
| CLI-15 | The account shows the prompt only without a personal cabinet | P1 | none | GET `/account` | `registration_prompt.show` is true only when `has_personal_account` is false; a personal cabinet (or `null`) means no prompt | `tests/account/client.spec.ts` |
| CLI-16 | An account created in the admin panel has a personal cabinet | P1 | `V4_ADMIN_CREATED_ACCOUNT=1`: the account comes from the admin panel (developers', testers') | GET `/account` | `has_personal_account == true`, `registration_prompt.show == false`. The dev team's rule, not in the spec; until a staging deploy on 20.10.2026 the test account answered `false` and got the prompt | `tests/account/client.spec.ts` (needs `V4_ADMIN_CREATED_ACCOUNT`) |

### 1.3 Profiles — `/profiles`, `/profiles/current`, `/profiles/{id}`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| PRF-01 | List the profiles | P0 | none | GET `/profiles` | 200; schema; `count == items.length` ≤ 5; exactly one `is_main`; unique ids | `tests/account/profiles.spec.ts` |
| PRF-02 | A fresh session acts as the main profile | P1 | fresh session | GET `/profiles/current` | 200; `is_main == true` | `tests/account/profiles.spec.ts` |
| PRF-03 | Read one profile | P1 | none | GET `/profiles/{main id}` | 200; equal to the list entry | `tests/account/profiles.spec.ts` |
| PRF-04 | Profile of another subscription | P1 | none | GET `/profiles/1` | 404 | `tests/account/profiles.spec.ts` |
| PRF-05 | Full lifecycle of an extra profile | P0 | fewer than 5 profiles | POST (name, `avatar_2`, 12) → GET → PUT without avatar → PATCH → PUT `/profiles/current` to it → DELETE | 201 with the payload; listed; PUT is a full replace (`avatar` back to `default`); PATCH behaves like PUT; current profile switches; after DELETE the session falls back to the main profile; GET and DELETE then answer 404 | `tests/account/profiles.spec.ts` |
| PRF-06 | DELETE answers without a body | P2 | an extra profile | DELETE `/profiles/{id}` | 204, no body | `tests/account/profiles.spec.ts` |
| PRF-07 | The main profile can't be deleted | P1 | none | DELETE `/profiles/{main id}` | 409 `E_NOT_ALLOWED` | `tests/account/profiles.spec.ts` |
| PRF-08 | At most five profiles | P1 | none | Create up to 5, then one more; clean up | 409 `E_LIMIT_EXCEEDED` for the sixth | `tests/account/profiles.spec.ts` |
| PRF-09 | Age band outside 0/7/12/16 | P1 | none | POST `{name, age_band: 5}` | 400 | `tests/account/profiles.spec.ts` |
| PRF-10 | Missing name | P2 | none | POST `{age_band: 0}` | 400 | `tests/account/profiles.spec.ts` |
| PRF-11 | Switch without `profile_id` | P1 | none | PUT `/profiles/current` `{}` | 400 `E_NEED_PARAM` | `tests/account/profiles.spec.ts` |
| PRF-12 | Switch to a foreign profile | P1 | none | PUT `/profiles/current` `{profile_id: 1}` | 404 | `tests/account/profiles.spec.ts` |
| PRF-13 | The switch is per session; favorites, recommendations and search stay on the main profile | P2 | an extra profile | Switch one session, compare `/profiles/current` and `/favorites` across two sessions | Only `/profiles/current` follows the switch, only in that session | — (not automated: needs two sessions at once) |

### 1.4 Favorites — `/favorites`, `PUT`/`DELETE …/favorite`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| FAV-01 | All favorites | P0 | none | GET `/favorites` | 200; schema; `count == items.length`; every item `favorite == true` | `tests/account/favorites.spec.ts` |
| FAV-02 | Favorite channels | P1 | none | GET `/favorites/channels` | 200; only `channel` / `playlist` / `radio` items, each also in GET `/favorites` | `tests/account/favorites.spec.ts` |
| FAV-03 | Favorites of one service | P1 | none | GET `/favorites/{service}` | 200; only that service's titles; as many as GET `/favorites` has for it | `tests/account/favorites.spec.ts` |
| FAV-04 | Service outside the documented list | P2 | none | GET `/favorites/playwright-no-such-service` | 404 | `tests/account/favorites.spec.ts` |
| FAV-05 | Add and remove a VOD title | P0 | a dashboard title that isn't a favorite | PUT, PUT again, GET `/favorites`, GET details, DELETE, DELETE again | 201, then 200 (idempotent); listed; `details.favorite == true`; 204, then 404; gone from the list. Always removed again | `tests/account/favorites.spec.ts` |
| FAV-06 | Add and remove a channel | P0 | a channel that isn't a favorite | Same as FAV-05 for `/channels/{id}/favorite` | 201, 200, listed in `/favorites/channels` with `favorite: true`; 204, 404, gone | `tests/account/favorites.spec.ts` |
| FAV-07 | Service aliases | P2 | none | PUT/GET with `ivi`, `start_film`, `tntpremier`, `film-ua`, `more-tv` | Same as the canonical id: listed and detailed under it, removed by the alias too | `tests/account/favorites.spec.ts` |

### 1.5 Sharing (Mobile Friend) — `/sharing/*`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| SHR-01 | Invite link from a TV device | P1 | the session's device is a TV | GET `/sharing/link` | 400 (mobile devices only) | `tests/account/sharing-and-prompt.spec.ts` |
| SHR-02 | Friend status | P2 | none | GET `/sharing/status` | 200, or 403 `E_ACCESS_DENIED` for an account that isn't a Mobile Friend | `tests/account/sharing-and-prompt.spec.ts` |
| SHR-03 | Friend list | P2 | none | GET `/sharing/friends` | 200, or the documented 503 | `tests/account/sharing-and-prompt.spec.ts` |
| SHR-04 | Redeem without a code | P2 | no session | POST `/sharing/redeem` `{}` | 400 | `tests/account/sharing-and-prompt.spec.ts` |
| SHR-05 | Invite link from a mobile device | P1 | a mobile device model; Premium packet | GET `/sharing/link` | 200 with the link and free slots | — (needs a mobile device id the server accepts) |
| SHR-06 | Send a verification code | P1 | mobile session | POST `/sharing/code` | 200; a code reaches the email or phone | — (excluded: sends a real email/SMS) |
| SHR-07 | Create friend credentials | P1 | a verification code | POST `/sharing/account` | 204 | — (excluded: changes the friend subscription) |
| SHR-08 | Revoke a friend | P1 | a friend share | DELETE `/sharing/friends/{friendLogin}` | 204 | — (excluded: revokes a real share) |
| SHR-09 | Redeem a valid invite | P1 | a real invite code | POST `/sharing/redeem` | 200 with a friend subscription | — (excluded: needs and consumes a real invite) |
| SHR-10 | Redeem rate limit | P2 | none | More than 10 redeems a minute from one IP | 429 `E_LIMIT_EXCEEDED` | — (excluded: deliberately hitting a shared limit) |

### 1.6 Registration prompt — `POST /registration-prompt/dismiss`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| REG-01 | The account reports the prompt state | P2 | none | GET `/account` | `registration_prompt.prompt_count` is 1 or 2 | `tests/account/sharing-and-prompt.spec.ts` |
| REG-02 | Unknown action | P1 | none | POST `action=playwright` (form-encoded) | 400; `registration_prompt` unchanged | `tests/account/sharing-and-prompt.spec.ts` |
| REG-03 | Missing action | P2 | none | POST with no fields | 400 | `tests/account/sharing-and-prompt.spec.ts` |
| REG-04 | `later` / `never` | P1 | prompt shown | POST `action=later`, `action=never` | 200; `later` shows the next variant after a while, `never` hides the prompt for good | — (excluded: one-way change to the account) |

## 2. Catalog

### 2.1 Channels — `/channels`, EPG, live, archive, teleteka, hidden channels

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| CH-01 | Channel list | P0 | none | GET `/channels` | 200; schema; `count == items.length` > 0; unique ids; `play_url` / `epg_url` / `favorite_url` are `/api/v4/channels/{id}/…` | `tests/catalog/channels.spec.ts` |
| CH-02 | Every channel's group is on the TV page | P1 | none | Compare `group_id`s with GET `/pages/tv` | Each `group_id` is one of the TV page's channel groups | `tests/catalog/channels.spec.ts` |
| CH-03 | Hidden channels aren't listed by default | P1 | none | GET `/channels` | No item has `access.hidden == true` | `tests/catalog/channels.spec.ts` |
| CH-04 | `show=1` needs the protect code | P2 | none | GET `/channels?show=1` | 400 `E_NEED_PARAM` (`protect` is mandatory) | `tests/catalog/channels.spec.ts` |
| CH-05 | EPG of a channel | P0 | none | GET `/channels/{id}/epg` | 200; schema; `channel.id` matches; programmes in broadcast order, each ending after it starts; within now − 14 days … now + 8 days | `tests/catalog/channels.spec.ts` |
| CH-06 | EPG `from` / `to` | P1 | none | GET `…/epg?from=now−6h&to=now` | Only programmes overlapping that window | `tests/catalog/channels.spec.ts` |
| CH-07 | EPG of a non-numeric id | P2 | none | GET `/channels/playwright/epg` | 404 | `tests/catalog/channels.spec.ts` |
| CH-08 | EPG of a channel outside the packet | P1 | none | GET `/channels/999999999/epg` | 403 | `tests/catalog/channels.spec.ts` |
| CH-09 | EPG `timeshift` / `title_id` | P2 | none | GET `…/epg?timeshift=…` / `?title_id=…` | `title_id`: only that title's airings. `timeshift`: times stay real broadcast times (docs), only the window's edges move | `tests/catalog/channels.spec.ts` |
| CH-10 | Play a live channel | P0 | none | GET `/channels/{id}/play` | 200; `playbackStream` schema; `url` set | `tests/catalog/channels.spec.ts` |
| CH-11 | Protected channel without the code | P1 | a protected channel in the packet | GET `…/play` | 403 `E_CURRENT_PASS_BAD` | `tests/catalog/channels.spec.ts` |
| CH-12 | Protected channel with the code | P1 | `V4_PROTECT_CODE` | GET `…/play?protect=<code>` | 200 | `tests/catalog/channels.spec.ts` (needs `V4_PROTECT_CODE`) |
| CH-13 | Channel outside the packet | P1 | none | GET `/channels/999999999/play` | 403 `E_NOT_ALLOWED` | `tests/catalog/channels.spec.ts` |
| CH-14 | Non-numeric channel id | P2 | none | GET `/channels/playwright/play` | 404 | `tests/catalog/channels.spec.ts` |
| CH-15 | Past programmes link to teleteka or archive | P1 | none | EPG of the last day | A programme with `teleteka: true` links to `…/teleteka/{starts_at}`, any other to `…/archive/{starts_at}` | `tests/catalog/channels.spec.ts` |
| CH-16 | Play from the archive | P0 | an unprotected channel with `capabilities.archive` | GET `…/archive/{starts_at}` of a programme that ended 3+ hours ago | 200; stream | `tests/catalog/channels.spec.ts` |
| CH-17 | Archive of a channel without archive | P1 | such a channel | GET `…/archive/{ts}` | 400 | `tests/catalog/channels.spec.ts` |
| CH-18 | Play a teleteka recording | P0 | a programme with `teleteka: true` | GET its `play_url` | 200; stream | `tests/catalog/channels.spec.ts` |
| CH-19 | **BUG:** teleteka of a programme without a recording **[A2]** | P1 | past programmes with `teleteka: false` | GET `…/teleteka/{starts_at}` for up to 12 of them | Docs: 403 `E_ARCHIVE_NOT_AVAILABLE`. Until the staging deploy of 21.10.2026 every one got 200 with a stub clip (`…/zaglushka/…`); since then some get the documented 403 and some still the stub, even on one channel. Each 403 must be the documented one; the test stays green while any programme gets the stub | `tests/catalog/channels.spec.ts` (pinned) |
| CH-20 | Teleteka at a timestamp no programme starts at | P2 | none | GET `…/teleteka/1` | 404 `E_WRONG_ID`, `Program not found` | `tests/catalog/channels.spec.ts` |
| CH-21 | Archive / teleteka of a protected channel | P2 | `V4_PROTECT_CODE`, a protected archive channel | Without and with `protect` | 403 `E_CURRENT_PASS_BAD`, then 200 | `tests/catalog/channels.spec.ts` (needs `V4_PROTECT_CODE`; teleteka only when the channel has a recording) |
| CH-22 | Hide without the protect code | P1 | `V4_PROTECT_CODE`; the account hides nothing yet | PUT `/channels/{id}/hidden` `{}` | 400 | `tests/catalog/channels.spec.ts` (needs `V4_PROTECT_CODE`) |
| CH-23 | Reset without the protect code | P1 | `V4_PROTECT_CODE`; the account hides nothing yet | DELETE `/channels/hidden` `{}` | 400 | `tests/catalog/channels.spec.ts` (needs `V4_PROTECT_CODE`) |
| CH-24 | Hide, list, unhide, reset | P1 | `V4_PROTECT_CODE`; the account hides nothing yet | PUT hidden (twice), GET `/channels`, GET `?show=1&protect=`, DELETE `…/hidden`, hide again, DELETE `/channels/hidden` | 204 each (idempotent); gone from the plain list; listed with `access.hidden` under `show=1`; back after unhide and after the reset | `tests/catalog/channels.spec.ts` (needs `V4_PROTECT_CODE`) |

### 2.2 Content — `/content/{service}/{id}` and its playback

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| CNT-01 | Movie details | P0 | a playable movie of a subscribed service on the dashboard | GET `/content/{service}/{id}` | 200; schema; `id` / `service` / `kind` match the card; `details_url`, `play_url`, `favorite_url`, `similar_url` point at the title itself | `tests/catalog/content.spec.ts` |
| CNT-02 | Series details | P0 | a playable series with episodes | Same | 200; schema; `episode_count == episodes.length` per season; episode `play_url` is `…/seasons/{n}/episodes/{episodeId}/play` | `tests/catalog/content.spec.ts` |
| CNT-03 | Unknown title | P1 | none | GET `/content/mediateka/playwright-no-such-title` | 404 | `tests/catalog/content.spec.ts` |
| CNT-04 | Unknown service | P1 | none | GET `/content/playwright-no-such-service/1` | 404 | `tests/catalog/content.spec.ts` |
| CNT-05 | **DOCS BUG:** services missing from the `{service}` enum **[D2]** | P2 | none | GET details of a dashboard card from `startru` / `iviru` | 200 — but the path parameter's enum doesn't list these services | `tests/catalog/content.spec.ts` (pinned) |
| CNT-06 | Similar titles | P1 | CNT-01 | GET `…/similar` | 200; schema; `count == items.length`; the title itself isn't among them | `tests/catalog/content.spec.ts` |
| CNT-07 | Play a movie | P0 | CNT-01 | GET `…/play` | 200; stream | `tests/catalog/content.spec.ts` |
| CNT-08 | Play an episode | P0 | CNT-02 | GET `…/seasons/{n}/episodes/{episodeId}/play` | 200; stream | `tests/catalog/content.spec.ts` |
| CNT-09 | Unknown episode | P1 | CNT-02 | Same with a made-up `episodeId` | 404 | `tests/catalog/content.spec.ts` |
| CNT-10 | Play a trailer | P1 | a card with `trailer_url` | GET details, then `…/trailers/{trailerId}/play` | The card's `trailer_url` is one of the details' trailers; 200 with `url` only (no `markers` / `vmap`) | `tests/catalog/content.spec.ts` |
| CNT-11 | **BUG:** made-up trailer id **[A1]** | P0 | one playable title per service | GET `…/trailers/playwright-no-such-trailer/play` | Docs: 404 `E_WRONG_ID`. Actually 200 for startru, mediateka and moretv; for the mediateka and moretv movies it's the very file `…/play` serves (the full title), for startru another stream named after the film. premierone and souzmultru answer 503 `E_SYSTEM_ERROR` (503 is documented only as `E_SERVICE_NOT_AVAILABLE`), only unicoplaycom the documented 404. Possible paywall bypass if the trailer route also skips `…/play`'s checks | `tests/catalog/content.spec.ts` (pinned) |
| CNT-12 | Title the card marks not playable | P1 | a card with `playable: false` | GET `…/play` | 403 | `tests/catalog/content.spec.ts` (skips: every title is playable for this account right now) |
| CNT-13 | Play an unknown title | P1 | none | GET `/content/mediateka/playwright-no-such-title/play` | 404 | `tests/catalog/content.spec.ts` |
| CNT-14 | Free episode without a session | P1 | a series of a service with free episodes | GET `/content/{service}/free/{episodeId}/play` with no cookie | 200 with a stream, or the documented 403 for an episode that isn't free | `tests/catalog/content.spec.ts` |
| CNT-15 | Unknown free episode | P2 | no session | GET `/content/mediateka/free/playwright-no-such-episode/play` | 404 | `tests/catalog/content.spec.ts` |
| CNT-16 | Title outside the caller's country | P1 | a client IP outside the title's release countries | Details / play | 403 | — (needs geo/IP control) |
| CNT-17 | Provider in failure mode | P2 | the operator switches a provider into failure mode | GET `…/play` | 200 with an apology clip, `markers` / `vmap` null | — (needs the operator's console) |
| CNT-18 | `progress` follows viewing | P2 | real playback of a title | Watch part of it; GET details | `progress.position` / `updated_at` updated | — (needs real playback) |

### 2.3 Radio (deprecated) — `GET /radio`, `GET /radio/{id}`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| RAD-01 | Station list | P1 | none | GET `/radio` | 200; unique ids; `_links.play` is `{method: GET, path: /api/v4/radio/{id}}` | `tests/catalog/radio.spec.ts` |
| RAD-02 | **BUG:** play links without `title` **[A8]** | P2 | none | GET `/radio` | Docs: `link` requires `title`. Actually missing on every station | `tests/catalog/radio.spec.ts` (pinned) |
| RAD-03 | **BUG:** `description: null` **[A8]** | P2 | none | GET `/radio` | Docs: a string. Actually null on some stations | `tests/catalog/radio.spec.ts` (pinned) |
| RAD-04 | Play a station | P1 | none | GET the `_links.play.path` | 200 `{url}` | `tests/catalog/radio.spec.ts` |

### 2.4 Search — `/search/services`, facets, history

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| SRCH-01 | Search by query | P0 | none | GET `/search/services?query=маша&limit=5` | 200; schema; `offset == 0`, `limit == 5`; `0 < count == items.length ≤ 5`; `total ≥ count` | `tests/catalog/search.spec.ts` |
| SRCH-02 | Paging via `next_url` | P1 | more than 2 results | Follow `next_url` of a `limit=2` page | `offset == 2`, same `total`, no overlap with page 1, `prev_url` present | `tests/catalog/search.spec.ts` |
| SRCH-03 | `service` filter | P1 | none | `?service=<subscribed>` | Only that service's titles | `tests/catalog/search.spec.ts` |
| SRCH-04 | `with_epg` | P2 | none | `?query=…&with_epg=true` | 200; schema (EPG hits allowed) | `tests/catalog/search.spec.ts` |
| SRCH-05 | `sort=-year` | P1 | none | `?sort=-year` | Years in non-increasing order | `tests/catalog/search.spec.ts` |
| SRCH-06 | Unknown service | P1 | none | `?service=playwright-no-such-service` | 400 naming the service | `tests/catalog/search.spec.ts` |
| SRCH-07 | `limit` below 1 / above 100 | P2 | none | `?limit=0`, `?limit=101` | 400 each | `tests/catalog/search.spec.ts` |
| SRCH-08 | Other filters | P2 | none | `genre`, `country`, `director`, `actor`, `from_year`/`to_year`, rating thresholds | Results match each filter | `tests/catalog/search.spec.ts` (`country`, years, both ratings; not `director` / `actor`: the subscribed services' details list no people to search for; `genre` is SRCH-10) |
| SRCH-09 | Genre facets | P1 | none | GET `/search/services/genres` | 200; `count == items.length`; every `count > 0`; `search_url` has `{genre}` | `tests/catalog/search.spec.ts` |
| SRCH-10 | A facet's `search_url` filters the search | P1 | SRCH-09 | Fill `{genre}` with a listed genre, follow it | 200; `total > 0` | `tests/catalog/search.spec.ts` |
| SRCH-11 | **DOCS BUG:** `search_url` vs its declared format **[D1]** | P2 | none | Validate `search_url` | A URI template (`{genre}`, `{query}`), as the spec's examples show, but declared `format: uri-reference`, which braces break | `tests/catalog/search.spec.ts` (pinned) |
| SRCH-12 | **BUG:** country facets **[A3]** | P1 | none | GET `/search/services/countries` | Docs: 200 with the countries. Actually 503 `E_SYSTEM_ERROR`, a status the operation doesn't document. Cause, from the staging trace: the search service returns a country with an empty `title`, and the schema check in `Search/Base.php:120` (`Client::countries()`) fails the whole list | `tests/catalog/search.spec.ts` (pinned) |
| SRCH-13 | Search history | P1 | none | GET `/search/history` | 200; `count == items.length`; every query lowercased; `history_url` / `search_url` (`{query}`) | `tests/catalog/search.spec.ts` |
| SRCH-14 | A repeat moves to the top, lowercased | P1 | non-empty history | POST the top query in capitals; GET | 201; the history is exactly as before | `tests/catalog/search.spec.ts` |
| SRCH-15 | Record without a query | P2 | none | POST `{}` | 400 | — (excluded: a request the server stored by mistake could only be undone by clearing the whole history; see SRCH-16) |
| SRCH-16 | Record a new query / a blank one | P2 | none | POST a new query; POST `"   "` | New one on top; blank one 400 | — (excluded: a stored entry can only be undone by clearing the whole history) |
| SRCH-17 | Clear the history | P2 | none | DELETE `/search/history` | 204; empty history | — (excluded: wipes the account's history) |

### 2.5 Services — `/services`, credentials, pages

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| SVC-01 | Service list | P0 | none | GET `/services` | 200; schema; unique ids; `pages_url` / `credentials_url`, when set, point at that service | `tests/catalog/services.spec.ts` |
| SVC-02 | The account has subscriptions | P1 | none | Inspect `access.state` | At least one `subscribed` | `tests/catalog/services.spec.ts` |
| SVC-03 | Pages of every service | P1 | none | GET `/services/{service}/pages` for each | 200; `service` echoes the id; `count == pages.length` | `tests/catalog/services.spec.ts` |
| SVC-04 | Pages of an unknown service | P2 | none | GET `/services/playwright-no-such-service/pages` | 404 | `tests/catalog/services.spec.ts` |
| SVC-05 | Credentials of a subscribed service | P1 | a subscribed service in the documented enum | GET `/services/{service}/credentials` | 200; `id` matches | `tests/catalog/services.spec.ts` |
| SVC-06 | Credentials of an unsubscribed service | P1 | such a service | Same | 503 `E_SERVICE_NOT_AVAILABLE` | `tests/catalog/services.spec.ts` |
| SVC-07 | Credentials of an unknown service | P2 | none | GET `/services/playwright-no-such-service/credentials` | 404 | `tests/catalog/services.spec.ts` |

## 3. Interface

### 3.1 Pages — `/pages/tv`, `/pages/radio`, `/pages/{slug}`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| PAGE-01 | TV page | P0 | none | GET `/pages/tv` | 200; `slug == "tv"`; only `channel_group` items, each `block_url` is `/api/v4/pages/tv/channel-groups/{id}` | `tests/interface/pages.spec.ts` |
| PAGE-02 | TV groups add up to the channel list | P1 | none | Sum the groups' `count` | Equals GET `/channels` `count` | `tests/interface/pages.spec.ts` |
| PAGE-03 | Radio page | P1 | none | GET `/pages/radio` | 200; `slug == "radio"`; lists `/api/v4/pages/radio/channel-group` | `tests/interface/pages.spec.ts` |
| PAGE-04 | Dashboard page | P0 | none | GET `/pages/dashboard` | 200; unique block ids; every `block_url` names a documented operation: `/api/v4/pages/dashboard/blocks/{id}` for editor blocks, `/api/v4/blocks/…` for personal ones | `tests/interface/pages.spec.ts` |
| PAGE-05 | Unknown slug | P1 | none | GET `/pages/playwright-no-such-page` | 404 | `tests/interface/pages.spec.ts` |

### 3.2 Blocks — page blocks, personal blocks, channel groups

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| BLK-01 | Every dashboard block loads from its `block_url` | P0 | none | GET each `block_url` of `/pages/dashboard` | 200; matches the schema of the operation the URL belongs to; `count == items.length` | `tests/interface/blocks.spec.ts` |
| BLK-02 | A page block is the one the page lists | P1 | none | Compare page-block answers with the page's summaries | Same `id` and `type` | `tests/interface/blocks.spec.ts` |
| BLK-03 | **BUG:** unknown page block **[A4]** | P1 | none | GET `/pages/dashboard/blocks/playwright-no-such-block` | Docs: 404. Actually 503 `E_SYSTEM_ERROR` | `tests/interface/blocks.spec.ts` (pinned) |
| BLK-04 | Block of an unknown page | P2 | none | GET `/pages/playwright-no-such-page/blocks/{id}` | 404 | `tests/interface/blocks.spec.ts` |
| BLK-05 | Follow a block link | P1 | an `ivi` / `start_film` block on the dashboard | GET `…/blocks/{id}/fetch` without following redirects | 302; `Location` carries the block's `title` and `type` | `tests/interface/blocks.spec.ts` (skips: no such block on the dashboard right now) |
| BLK-06 | Unknown link of a block | P2 | none | GET `…/blocks/{id}/playwright-no-such-link` | 404 `E_WRONG_ID` | `tests/interface/blocks.spec.ts` |
| BLK-07 | **BUG:** link of an unknown block **[A4]** | P2 | none | GET `…/blocks/playwright-no-such-block/fetch` | Docs: 404 `E_SYSTEM_ERROR`. Actually 503 | `tests/interface/blocks.spec.ts` (pinned) |
| BLK-08 | Continue-watching block | P0 | none | GET `/blocks/playback` | 200; `id`/`type` `playback`; `count == items.length` ≤ 20; every item has a `play_url` | `tests/interface/blocks.spec.ts` |
| BLK-09 | `limit` and `title` of the playback block | P1 | none | `?limit=1&title=Playwright` | `title` echoed; `count ≤ 1` | `tests/interface/blocks.spec.ts` |
| BLK-10 | **BUG:** playback `limit` outside 1–100 **[A6]** | P2 | none | `?limit=0`, `?limit=101` | Docs: 1–100, 400 for invalid input. Actually 200 | `tests/interface/blocks.spec.ts` (pinned) |
| BLK-11 | Playback block of TV | P1 | none | GET `/blocks/playback/channels` | Only `kind: program`, `service: channels` | `tests/interface/blocks.spec.ts` |
| BLK-12 | Playback block of a VOD service | P1 | none | GET `/blocks/playback/premierone` | Only that service's titles | `tests/interface/blocks.spec.ts` |
| BLK-13 | Unknown playback origin | P2 | none | GET `/blocks/playback/playwright-no-such-origin` | 404 | `tests/interface/blocks.spec.ts` |
| BLK-14 | Playback block rules | P2 | controlled viewing history | Watch under 90 s, past 95 %, finish an episode, wait 14 days | Short and nearly-finished entries skipped; a finished episode yields the next; nothing older than 14 days | — (needs real viewing) |
| BLK-15 | Personal blocks (×4) | P1 | none | GET `/blocks/watching-now`, `/recommendations`, `/client-channels`, `/last-news` | 200; schema; `count == items.length` | `tests/interface/blocks.spec.ts` |
| BLK-16 | Watching-now size | P2 | none | GET `/blocks/watching-now` | At most 25 titles | `tests/interface/blocks.spec.ts` |
| BLK-17 | Client-channels size | P2 | none | GET `/blocks/client-channels` | At most 20 channels | `tests/interface/blocks.spec.ts` |
| BLK-18 | TV channel groups | P0 | none | GET each `/pages/tv/channel-groups/{id}` | 200; `id` matches; `count == items.length` == the TV page's count for it | `tests/interface/blocks.spec.ts` |
| BLK-19 | Unknown TV channel group | P2 | none | GET `/pages/tv/channel-groups/999999` | 404 | `tests/interface/blocks.spec.ts` |
| BLK-20 | Radio channel group | P1 | none | GET `/pages/radio/channel-group` | 200; `count == items.length`; at least one playable station | `tests/interface/blocks.spec.ts` |
| BLK-21 | **BUG:** radio stations with `kind: "channel"` **[A7]** | P2 | none | Inspect the radio group's items | Docs: `radioCard.kind` is always `"radio"`. Actually `"channel"` for some | `tests/interface/blocks.spec.ts` (pinned) |
| BLK-22 | **DOCS BUG:** the "favorite-channels" block isn't the favorites **[D3]** | P2 | a channel that isn't a favorite | Add it to the favorites, GET `/blocks/client-channels`; remove it again | The summary says "the client's favorite-channels block" (titled «Любимые телеканалы»), the description and the server say most-watched: the fresh favorite isn't in it | `tests/account/favorites.spec.ts` (pinned) |

## 4. Other — `/servertime`, `/screensaver`, `/speedtest`

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|----------------|-------|------------------|-----------|
| OTH-01 | Server time | P1 | no session | GET `/servertime` | 200; within 5 min of the local clock; equal (±2 s) to `X-Api-Servertime` | `tests/other/other.spec.ts` |
| OTH-02 | Screensaver | P2 | no session | GET `/screensaver` | 200; `count == items.length` | `tests/other/other.spec.ts` |
| OTH-03 | Speed test servers | P2 | none | GET `/speedtest` | 200; `0 < count == items.length` | `tests/other/other.spec.ts` |

## 5. Cross-cutting

| ID | Title | Prio | Steps | Expected result | Automated |
|----|-------|------|-------|------------------|-----------|
| GEN-01 | Every response matches its documented contract | P0 | Any request | The status is documented for the operation; documented headers present (`X-Api-Version: 4`, `X-Api-Servertime`, `X-Api-Messages`, `X-Token` …); media type and body match the response schema | Every `expectResponse` call, i.e. every test above |
| GEN-02 | Error envelope | P0 | Any documented error | `application/problem+json` `{error: {type, code, message, request_id, details}}`; `X-Api-Error-Code` equals `error.code`; `X-Api-Error-Message` set; `request_id` is a UUID v7 | Every `expectError` call; `tests/other/errors.spec.ts` |
| GEN-03 | Every operation that needs a session refuses an anonymous caller (×65) | P0 | Call each secured operation without a cookie, path parameters from the spec's examples | 403 `E_AUTH_ERROR` | `tests/other/auth-required.spec.ts` |
| GEN-04 | Operations open without a session | P1 | `/login`, `/servertime`, `/screensaver`, `/content/{service}/free/{id}/play`, `/sharing/redeem` without a cookie | Answer by their own logic, not 403 `E_AUTH_ERROR` | SEC-08…11, OTH-01/02, CNT-14/15, SHR-04 (their tests also carry `@GEN-04`) |
| GEN-05 | **BUG:** no `ETag`, so no `304` **[A5]** | P1 | GET a response that documents `ETag`, then repeat with `If-None-Match` | Docs: `ETag` on 19 responses, 304 on a match. Actually no response carries an ETag | `tests/other/caching.spec.ts` (pinned) |
| GEN-06 | `X-Clear-Cache` | P2 | GET `/channels` with `X-Clear-Cache: 1` | 200; same resource | `tests/other/caching.spec.ts` |
| GEN-07 | **BUG:** staging leaks its debug trace **[S1]** | P1 | Any error on staging | Docs: `error` only. Staging adds `exception` (Symfony trace: classes, server paths, internal hosts) and `X-Debug-Token(-Link)` headers; production doesn't | `tests/other/errors.spec.ts` (pinned) |
| GEN-08 | Documented examples match their schemas (×235) | P1 | Validate every `example` / `examples` entry against the schema it illustrates | All valid | `tests/other/spec-examples.spec.ts` |
| GEN-09 | **DOCS BUG:** four examples break their own schema **[D1]** | P2 | Same as GEN-08 | `next_url` with unencoded Cyrillic (`searchServices`), `search_url` templates (countries, genres, history) aren't `format: uri-reference` | `tests/other/spec-examples.spec.ts` (pinned) |
| GEN-10 | **DOCS BUG:** operations without an `operationId` **[D4]** | P2 | Inspect the spec | Every other operation has one; `GET /radio` and `GET /radio/{id}` don't | `tests/other/spec-examples.spec.ts` (pinned) |

## 6. Web client — playtest.kartina.tv (browser)

The web client on staging (it calls `rustvt.kartina.tv/api/v4`), driven in a browser by
the `browser-ui` project (`ui-tests/`). It logs in once through its own form
(`browser-setup`); each test then checks the UI against API v4 read on the browser's
own session. `npm run test:browser` runs these alone.

| ID | Title | Prio | Preconditions | Steps | Expected result | Automated |
|----|-------|------|---------------|-------|-----------------|-----------|
| UI-01 | Unknown login on the form | P1 | no session | Enter `not-a-login` / `x`, press Enter | POST `/login` 403 `E_INCORRECT_LOGIN`; still on `/login`; no account stored | `ui-tests/login.spec.ts` |
| UI-02 | Hero slider = the dashboard's first block | P0 | none | Open `/home`; GET `/pages/dashboard` and its first block | The active slide shows the block's first title; the counter reads `1 из {items}` | `ui-tests/dashboard.spec.ts` |
| UI-03 | Title page shows the API's details | P0 | none | Open the first title card; GET `/content/{service}/{id}` | Heading = `title.display`; year and every genre shown | `ui-tests/content.spec.ts` |
| UI-04 | Watch button starts playback | P0 | the title is playable | On the title page press «Смотреть» / «Продолжить» | GET `…/play` 200; `/watch/…`; the video plays (> 2 s) | `ui-tests/content.spec.ts` |
| UI-05 | Add to / remove from favorites on the title page | P1 | the title isn't a favorite | Press «Добавить в избранное», then press it again | PUT `…/favorite` 201, title marked favorite in the API; DELETE 204, not a favorite | `ui-tests/favorites.spec.ts` |
| UI-06 | A channel group lists its channels | P1 | none | «Телевидение» → the first group | Channel names = GET `/pages/tv/channel-groups/{id}`, in order | `ui-tests/tv.spec.ts` |
| UI-07 | A channel plays live | P0 | none | Click the group's first channel | `/tv/channel/{id}/live`; GET `/channels/{id}/play` 200; the video plays (> 2 s) | `ui-tests/tv.spec.ts` |
| UI-08 | The channel page shows what's on air | P1 | a programme on air | Open a channel; GET `/channels/{id}/epg` | The programme on air by the EPG is shown | `ui-tests/tv.spec.ts` |
| UI-09 | A radio station plays | P1 | none | «Радио» → the first station | GET `/channels/{id}/play` 200; the banner shows the station's name; it plays (> 2 s) | `ui-tests/radio.spec.ts` |
| UI-10 | Search shows results and keeps the history | P1 | non-empty search history | Open `/search?q=` with the history's top query (the client POSTs every search to the history; a repeat of the top one changes nothing) | «Результаты поиска "…"»; the first result of GET `/search/services` shown; the history is exactly as before | `ui-tests/search.spec.ts` |
| UI-11 | Subscription info in the settings | P1 | none | Open `/settings/account`; GET `/account` | Login, packet title and end date shown | `ui-tests/settings.spec.ts` |
| UI-12 | A recorded programme plays from the teleteka | P1 | a recorded programme whose title and hours are unique on the list | On the channel page click it | `/tv/channel/{id}/teleteka/{starts_at}`; GET `…/teleteka/{starts_at}` 200; the video plays (> 2 s) | `ui-tests/tv.spec.ts` |
| UI-13 | Profiles in the web client | P2 | none | — | — | — (the client has no profile UI: no `/profiles` calls, the account button opens the settings) |
| UI-14 | Streaming settings | P2 | none | Open `/settings/streaming-settings`; GET `/settings` on the browser's session (settings belong to its device) | «Сервер вещания» and «Задержка вещания в часах» show the labels of the current `server` / `timeshift` values | `ui-tests/settings.spec.ts` |
| UI-15 | A past programme without a teleteka recording plays from the archive | P1 | such a programme in the last day on one of the first channels | On the channel page, once live is playing, click it | `/tv/channel/{id}/archive/{starts_at}`; GET `…/archive/{starts_at}` 200; the video advances. (The client doesn't ask the teleteka here, so the API's stub, A2, never reaches it.) | `ui-tests/tv.spec.ts` |
| UI-18 | «Next slide» on the hero slider | P2 | the slider has 2+ slides | Open `/home`, click «Next slide» | The active slide shows the block's second title; the counter reads `2 из {items}`. Known playtest bug: clicked right after load, the counter can fall out of step (fails now and then, left as it is) | `ui-tests/dashboard.spec.ts` |
| UI-19 | «Описание» tab: description and cast | P2 | none | On the first title's page click «Описание» | The description and the first actors of GET `/content/{service}/{id}` shown | `ui-tests/content.spec.ts` |
| UI-20 | «Трейлеры» tab | P2 | none | Open the first title's page | The tab is there exactly when the title has trailers; it opens in place (same URL) | `ui-tests/content.spec.ts` |
| UI-21 | Back button on the title page | P2 | none | Open a title, press back | Back on `/home` | `ui-tests/content.spec.ts` |
| UI-22 | «Избранное» page | P1 | the account has favorite titles | Open «Избранное»; GET `/favorites` | A tile for every favorite title; opening one shows its title | `ui-tests/favorites.spec.ts` |
| UI-23 | Service catalogs (START, Wink, PREMIER) | P1 | none | «Видеотека» → the service; GET `/services/{service}/pages`, then its page | The page's first `list` rows are shown by title | `ui-tests/catalog.spec.ts` |
| UI-24 | Stop a radio station | P2 | none | On a playing station press the play button | Its icon changes and playback stops. Its tooltip still says «Остановить воспроизведение» **[W2]** (recorded as a known issue) | `ui-tests/radio.spec.ts` |
| UI-25 | **BUG:** the client keeps the password in plain text **[W1]** | P0 | a browser session | Open `/home`; read whether `___kartina.tv.account` in localStorage has a non-empty `pass` (never its value) | It should not. Actually it does: the client stores the password and logs in again with it on every page load; the test stays green while it does | `ui-tests/client-security.spec.ts` (pinned) |
| UI-26 | A rejected login shows a message | P2 | no session | Enter `not-a-login` / `x`, press Enter | POST `/login` 403; the banner «Ошибка 4: Неправильный абонемент или пароль…» shows | `ui-tests/login.spec.ts` |
| UI-27 | **BUG:** a programme picked before the live stream starts stays paused **[W4]** | P2 | a past programme of the last day that can be told apart on the channel page | Open `/tv/channel/{id}/live`; click the programme's row before the live stream plays | It should play. Actually GET `…/archive/{starts_at}` (or `…/teleteka/…`) 200, the recording loads in full, but the video stays at 0 s; the test stays green while it does | `ui-tests/tv.spec.ts` (pinned) |
| UI-16 | Change the parental password in the settings | P2 | `V4_PROTECT_CODE` | `/settings/parent-control` form | — | — (excluded: the protect code could stay changed, as CLI-14) |
| UI-17 | «Очистить историю поиска» in the settings | P2 | none | `/settings/additional-settings` | — | — (excluded: wipes the account's search history, as SRCH-17) |

## Remaining gaps

Not gaps in effort; each needs something this black-box position on a real account
doesn't have, or would cost the account something it can't get back:

- **Changes the suite won't make to the real account** (SEC-12, SEC-13, CLI-14, SHR-06,
  SHR-07, SHR-08, SHR-09, REG-04, SRCH-15, SRCH-16, SRCH-17, UI-16, UI-17): a wrong password risks a lockout,
  a 4th session evicts real devices, a changed protect code could stay changed, the
  sharing calls send real codes or alter the friend subscription, the prompt answer
  is one-way, the search history can only be cleaned up by wiping it. A dedicated
  test account would unlock all of them.
- **Two sessions at once** (CLI-08, PRF-13): the suite holds one shared session plus one
  short-lived aux session; these need both alive for the length of a test.
- **A mobile device** (SHR-05): the sharing link is mobile-only; it needs a mobile
  device model the server accepts.
- **Geo / deployment / operator** (SEC-15, CNT-16, CNT-17): a client in another country,
  a geo-routed deployment, the operator switching a provider into failure mode.
- **Real viewing** (CNT-18, BLK-14): progress and the continue-watching rules need
  actual playback over time.
- **Rate limits** (SHR-10): not hit on purpose; the limit is shared per IP.
- **Not in the web client** (UI-13): it has no profiles UI.
