import { writeFile } from 'node:fs/promises';
import { test as teardown, expect } from '@playwright/test';
import { V4ApiClient } from '../src/client';
import { v4UiOrigin } from '../src/config';
import { EMPTY_STORAGE_STATE } from '../tests/session';
import { BROWSER_SESSION_FILE, hasBrowserSession } from './session';

// Ends the browser session and empties the storage state, which holds the password.
// The session to end is the one the last page load opened: loading the client once
// more re-logs in on the same serial (ending that one), then this session is logged out.
teardown('close the web client session', async ({ page }) => {
  teardown.skip(!hasBrowserSession(), 'No web client session was opened');
  try {
    const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
    await page.goto(`${v4UiOrigin}/home`);
    expect((await login).status(), 'the client logged in again').toBe(200);
    const api = new V4ApiClient(page.request);
    expect((await api.logout()).status(), 'POST /logout of the browser session').toBe(204);
    expect((await api.getAccount()).status(), 'GET /account after the logout').toBe(403);
  } finally {
    await writeFile(BROWSER_SESSION_FILE, JSON.stringify(EMPTY_STORAGE_STATE));
  }
});
