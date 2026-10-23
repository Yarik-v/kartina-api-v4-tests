import { test, expect } from './fixtures';
import { v4UiOrigin } from '../src/config';
import { EMPTY_STORAGE_STATE } from '../tests/session';
import { ACCOUNT_KEY } from './session';

// A login that can't exist, never a wrong password for the real account (a long
// number like 99999999999 can be someone else's subscription).
const NOT_A_LOGIN = 'not-a-login';

test.describe('login form', { tag: '@no-session' }, () => {
  test.use({ storageState: EMPTY_STORAGE_STATE });

  test('an unknown login stays on the form and opens no session', { tag: '@UI-01' }, async ({ page }) => {
    await page.goto(`${v4UiOrigin}/login`);
    await page.getByPlaceholder('Номер абонемента').fill(NOT_A_LOGIN);
    await page.getByPlaceholder('Пароль').fill('x');
    const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
    await page.keyboard.press('Enter');
    const res = await login;
    expect(res.status(), 'POST /login').toBe(403);
    expect((await res.json()).error.type).toBe('E_INCORRECT_LOGIN');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByPlaceholder('Номер абонемента')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_KEY), 'no account stored').toBeNull();
  });
});
