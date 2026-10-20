// Settings from .env. Values are read here but validated by the fixtures
// (`assertValidV4Host`), not at import: playwright.config.ts imports this module, and
// a throw there would hide the message behind a config-loading error.

// The `host` / `scheme` server variables of spec/openapi.yaml. rustvt is the
// staging middleware (its error responses carry the Symfony debug trace), iptv the
// production one.
const ALLOWED_HOSTS = ['rustvt.kartina.tv', 'iptv.kartina.tv', 'localhost'] as const;
const ALLOWED_SCHEMES = ['https', 'http'] as const;

export const v4Host = process.env.V4_API_HOST ?? 'rustvt.kartina.tv';
const v4Scheme = process.env.V4_API_SCHEME ?? 'https';
// Trailing slash matters: APIRequestContext resolves relative request paths against
// this URL per WHATWG URL rules, so without it "login" would resolve to
// "https://{host}/api/login" instead of "https://{host}/api/v4/login".
export const v4BaseURL = `${v4Scheme}://${v4Host}/api/v4/`;

export const v4Login = process.env.V4_LOGIN ?? '';
export const v4Password = process.env.V4_PASSWORD ?? '';
/** Needed only by the protect-code and hidden-channel tests; they skip without it. */
export const v4ProtectCode = process.env.V4_PROTECT_CODE ?? '';
/**
 * Set (`1`) when the account was created in the admin panel: those are the
 * developers' and testers' accounts, and they always have a personal cabinet
 * (`has_personal_account: true`). Not in the spec; the dev team's rule.
 */
export const v4AdminCreatedAccount = process.env.V4_ADMIN_CREATED_ACCOUNT === '1';

// The server only accepts device models it knows (`Device ... not found.`), so this is
// a real one, taken from the spec's own example.
export const v4Device = process.env.V4_DEVICE ?? 'androidtv-yb-005';
// One session per serial: a new login with the same serial ends the previous session
// of that serial. The suite holds at most two sessions at once: the shared one every
// test uses, and a second one the login/logout tests open and close themselves.
export const v4Serial = process.env.V4_SERIAL ?? 'playwright-v4-main';
export const v4AuxSerial = `${v4Serial}-aux`;

export const isStaging = v4Host === 'rustvt.kartina.tv';

/** Throws a clear error unless V4_API_HOST / V4_API_SCHEME are values the spec allows. */
export function assertValidV4Host(): void {
  if (!(ALLOWED_HOSTS as readonly string[]).includes(v4Host)) {
    throw new Error(`V4_API_HOST must be one of ${ALLOWED_HOSTS.join(', ')}, got "${v4Host}"`);
  }
  if (!(ALLOWED_SCHEMES as readonly string[]).includes(v4Scheme)) {
    throw new Error(`V4_API_SCHEME must be one of ${ALLOWED_SCHEMES.join(', ')}, got "${v4Scheme}"`);
  }
}
