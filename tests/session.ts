import { existsSync, readFileSync } from 'node:fs';

/**
 * Storage state with the MW_SSID cookie of the session every api-v4 test shares.
 * Written by auth.setup.ts on each run, ended by auth.teardown.ts. Never committed
 * (.gitignore): it's a live session of a real account.
 */
export const V4_SESSION_FILE = 'tests/.auth/session.json';

export const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };

export const NO_SESSION_REASON = 'No API v4 session: set V4_LOGIN and V4_PASSWORD in .env';

/** Tag for tests that run without a session; every other api-v4 test needs one. */
export const NO_SESSION_TAG = '@no-session';

/** Tag for tests that change the account; they run in the api-v4-mutating project. */
export const MUTATES_TAG = '@mutates';

export function hasV4Session(): boolean {
  if (!existsSync(V4_SESSION_FILE)) return false;
  const state = JSON.parse(readFileSync(V4_SESSION_FILE, 'utf8')) as { cookies?: { name: string }[] };
  return Boolean(state.cookies?.some((cookie) => cookie.name === 'MW_SSID'));
}
