// Settings from .env, in plain JS so the tests and the bug-report scripts share them.
// The host is validated by `assertValidV4Host()`, not at import: a throw while
// playwright.config.ts loads would hide the message behind a config error.

/**
 * `process.env[name]`, or `fallback` when unset or empty (dotenv turns `KEY=` into '').
 * @param {string} name
 * @param {string} fallback
 */
const env = (name, fallback) => process.env[name] || fallback;

// The `host` / `scheme` server variables of spec/openapi.yaml: rustvt is staging (its
// errors carry the Symfony debug trace), iptv production.
export const ALLOWED_HOSTS = ['rustvt.kartina.tv', 'iptv.kartina.tv', 'localhost'];
const ALLOWED_SCHEMES = ['https', 'http'];
/** @type {Record<string, string>} */
export const HOST_LABELS = { 'rustvt.kartina.tv': 'staging', 'iptv.kartina.tv': 'production', localhost: 'localhost' };

export const v4Host = env('V4_API_HOST', 'rustvt.kartina.tv');
const v4Scheme = env('V4_API_SCHEME', 'https');
/** Without the trailing slash, for building absolute URLs. */
export const v4Origin = `${v4Scheme}://${v4Host}/api/v4`;
// The trailing slash matters: without it a relative "login" resolves to /api/login,
// not /api/v4/login.
export const v4BaseURL = `${v4Origin}/`;

export const v4Login = env('V4_LOGIN', '');
export const v4Password = env('V4_PASSWORD', '');
/** Needed only by the protect-code and hidden-channel tests; they skip without it. */
export const v4ProtectCode = env('V4_PROTECT_CODE', '');
/**
 * `1` for an account created in the admin panel (developers, testers): it always has
 * a personal cabinet. The dev team's rule, not the spec's.
 */
export const v4AdminCreatedAccount = process.env.V4_ADMIN_CREATED_ACCOUNT === '1';

// The server accepts only device models it knows; this one is the spec's example.
export const v4Device = env('V4_DEVICE', 'androidtv-yb-005');
// A login ends the previous session of the same serial. The suite holds at most two:
// the shared one and an aux one the login/logout tests open and close.
export const v4Serial = env('V4_SERIAL', 'playwright-v4-main');
export const v4AuxSerial = `${v4Serial}-aux`;

export const isStaging = v4Host === 'rustvt.kartina.tv';

/**
 * `V4_MUTATING_ONLY=1` leaves the read-only projects out, so a mutating case runs right
 * after the setup. Exactly `1`: `0` or `false` must not switch it on.
 */
export const v4MutatingOnly = process.env.V4_MUTATING_ONLY === '1';

/**
 * The web client the browser tests drive. It picks its API host from its own address
 * (playtest.kartina.tv talks to rustvt.kartina.tv), so it's tied to staging.
 */
export const v4UiOrigin = 'https://playtest.kartina.tv';

/** `V4_BROWSER_ONLY=1`: the run has only the browser projects (`npm run test:browser`). */
export const v4BrowserOnly = process.env.V4_BROWSER_ONLY === '1';

/** Throws a clear error unless V4_API_HOST / V4_API_SCHEME are values the spec allows. */
export function assertValidV4Host() {
  if (!ALLOWED_HOSTS.includes(v4Host)) {
    throw new Error(`V4_API_HOST must be one of ${ALLOWED_HOSTS.join(', ')}, got "${v4Host}"`);
  }
  if (!ALLOWED_SCHEMES.includes(v4Scheme)) {
    throw new Error(`V4_API_SCHEME must be one of ${ALLOWED_SCHEMES.join(', ')}, got "${v4Scheme}"`);
  }
}
