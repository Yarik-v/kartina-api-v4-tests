import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { isStaging, v4Login, v4Password, v4UiOrigin } from '../src/config';
import { EMPTY_STORAGE_STATE } from '../tests/session';
import { ACCOUNT_KEY, BROWSER_NO_SESSION_REASON, BROWSER_SESSION_FILE } from './session';

// Logs in once through the client's own form and saves the storage state every
// browser test starts from. The client can't take over the API suite's session: it
// decides it's logged in by its localStorage entry, not by the cookie, and re-logs in
// with the stored password on every page load (same serial, so the previous browser
// session ends each time: the run holds one browser session at a time).
setup('log in to the web client through its form', async ({ page }) => {
  await mkdir(path.dirname(BROWSER_SESSION_FILE), { recursive: true });
  // Written up front, so a failed or skipped login never leaves an old session behind.
  await writeFile(BROWSER_SESSION_FILE, JSON.stringify(EMPTY_STORAGE_STATE));
  setup.skip(!isStaging, 'playtest.kartina.tv talks to staging (rustvt.kartina.tv) only');
  setup.skip(!v4Login || !v4Password, BROWSER_NO_SESSION_REASON);

  // "Отклонить все" on the cookie banner: the choice is saved with the storage state.
  await page.addLocatorHandler(page.locator('#cmpbox'), async (banner) => {
    await banner.locator('.cmpboxbtnno').click();
  });
  await page.goto(`${v4UiOrigin}/login`);
  await page.getByPlaceholder('Номер абонемента').fill(v4Login);
  await page.getByPlaceholder('Пароль').fill(v4Password);
  const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await login).status(), 'POST /login from the form').toBe(200);
  await page.waitForURL(/\/home/);
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, ACCOUNT_KEY), 'the client stored the account').toBe(true);
  await page.context().storageState({ path: BROWSER_SESSION_FILE });
});
