import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { v4UiOrigin } from '../src/config';
import { EMPTY_STORAGE_STATE } from '../tests/session';
import { ACCOUNT_KEY } from './session';

// A login that can't exist, never a wrong password for the real account (a long
// number like 99999999999 can be someone else's subscription).
const NOT_A_LOGIN = 'not-a-login';

/** Submits the form with the unknown login; returns the POST /login response. */
async function submitUnknownLogin(page: Page) {
  await page.goto(`${v4UiOrigin}/login`);
  await page.getByPlaceholder('Номер абонемента').fill(NOT_A_LOGIN);
  await page.getByPlaceholder('Пароль').fill('x');
  const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
  await page.keyboard.press('Enter');
  return login;
}

test.describe('login form', { tag: '@no-session' }, () => {
  test.use({ storageState: EMPTY_STORAGE_STATE });

  test('an unknown login stays on the form and opens no session', { tag: '@UI-01' }, async ({ page }) => {
    const res = await submitUnknownLogin(page);
    expect(res.status(), 'POST /login').toBe(403);
    expect((await res.json()).error.type).toBe('E_INCORRECT_LOGIN');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByPlaceholder('Номер абонемента')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_KEY), 'no account stored').toBeNull();
  });

  test('a rejected login shows the error message', { tag: '@UI-26' }, async ({ page }) => {
    const res = await submitUnknownLogin(page);
    expect(res.status(), 'POST /login').toBe(403);
    // A banner at the top of the page, outside the form.
    await expect(page.getByText(/Неправильный абонемент или пароль/)).toBeVisible();
  });
});
