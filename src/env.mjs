// Settings from .env, in plain JS so both the tests (through src/config.ts) and the
// plain-node bug-report scripts read the same values and the same host check.
// Values are read here but validated by `assertValidV4Host()`, not at import:
// playwright.config.ts imports this module, and a throw there would hide the message
// behind a config-loading error.

/**
 * `process.env[name]`, or `fallback` when it's unset or empty: dotenv sets `KEY=` to
 * '', which would otherwise switch the default off.
 * @param {string} name
 * @param {string} fallback
 */
const env = (name, fallback) => process.env[name] || fallback;

// The `host` / `scheme` server variables of spec/openapi.yaml. rustvt is the
// staging middleware (its error responses carry the Symfony debug trace), iptv the
// production one.
export const ALLOWED_HOSTS = ['rustvt.kartina.tv', 'iptv.kartina.tv', 'localhost'];
const ALLOWED_SCHEMES = ['https', 'http'];
/** @type {Record<string, string>} */
export const HOST_LABELS = { 'rustvt.kartina.tv': 'staging', 'iptv.kartina.tv': 'production', localhost: 'localhost' };

export const v4Host = env('V4_API_HOST', 'rustvt.kartina.tv');
const v4Scheme = env('V4_API_SCHEME', 'https');
/** Without the trailing slash, for building absolute URLs. */
export const v4Origin = `${v4Scheme}://${v4Host}/api/v4`;
// Trailing slash matters: APIRequestContext resolves relative request paths against
// this URL per WHATWG URL rules, so without it "login" would resolve to
// "https://{host}/api/login" instead of "https://{host}/api/v4/login".
export const v4BaseURL = `${v4Origin}/`;

export const v4Login = env('V4_LOGIN', '');
export const v4Password = env('V4_PASSWORD', '');
/** Needed only by the protect-code and hidden-channel tests; they skip without it. */
export const v4ProtectCode = env('V4_PROTECT_CODE', '');
/**
 * Set (`1`) when the account was created in the admin panel: those are the
 * developers' and testers' accounts, and they always have a personal cabinet
 * (`has_personal_account: true`). Not in the spec; the dev team's rule.
 */
export const v4AdminCreatedAccount = process.env.V4_ADMIN_CREATED_ACCOUNT === '1';

// The server only accepts device models it knows (`Device ... not found.`), so this is
// a real one, taken from the spec's own example.
export const v4Device = env('V4_DEVICE', 'androidtv-yb-005');
// One session per serial: a new login with the same serial ends the previous session
// of that serial. The suite holds at most two sessions at once: the shared one every
// test uses, and a second one the login/logout tests open and close themselves.
export const v4Serial = env('V4_SERIAL', 'playwright-v4-main');
export const v4AuxSerial = `${v4Serial}-aux`;

export const isStaging = v4Host === 'rustvt.kartina.tv';

/** Throws a clear error unless V4_API_HOST / V4_API_SCHEME are values the spec allows. */
export function assertValidV4Host() {
  if (!ALLOWED_HOSTS.includes(v4Host)) {
    throw new Error(`V4_API_HOST must be one of ${ALLOWED_HOSTS.join(', ')}, got "${v4Host}"`);
  }
  if (!ALLOWED_SCHEMES.includes(v4Scheme)) {
    throw new Error(`V4_API_SCHEME must be one of ${ALLOWED_SCHEMES.join(', ')}, got "${v4Scheme}"`);
  }
}
