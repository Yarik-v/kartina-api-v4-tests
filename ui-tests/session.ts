import { existsSync, readFileSync } from 'node:fs';
import { v4UiOrigin } from '../src/config';

/**
 * Storage state of the web client after a login through its form: the MW_SSID cookie
 * and the client's own localStorage. Written by browser.setup.ts, emptied by
 * browser.teardown.ts; gitignored. It holds the account's PASSWORD in plain text: the
 * client keeps it in localStorage (`___kartina.tv.account`, field `pass`) and logs in
 * again with it on every page load.
 */
export const BROWSER_SESSION_FILE = 'tests/.auth/browser.json';

export const BROWSER_NO_SESSION_REASON = 'No web client session: set V4_LOGIN and V4_PASSWORD in .env';

/** Where the client keeps the logged-in account. */
export const ACCOUNT_KEY = '___kartina.tv.account';

export function hasBrowserSession(): boolean {
  if (!existsSync(BROWSER_SESSION_FILE)) return false;
  const state = JSON.parse(readFileSync(BROWSER_SESSION_FILE, 'utf8')) as {
    origins?: { origin: string; localStorage: { name: string }[] }[];
  };
  const origin = state.origins?.find((o) => o.origin === v4UiOrigin);
  return Boolean(origin?.localStorage.some((item) => item.name === ACCOUNT_KEY));
}
