import { recordKnownIssue } from '../src/assertions';
import { test, expect, openHome } from './fixtures';
import { ACCOUNT_KEY } from './session';

test.describe('client security', () => {
  // Pinned: once the client stops keeping the password, this fails; then flip it.
  test('the client keeps the account password in plain text in localStorage (known client bug)', { tag: ['@UI-25', '@pinned'] }, async ({ page }) => {
    await openHome(page);
    // Only whether the field is there and non-empty is read, never its value.
    const stored = await page.evaluate((key) => {
      const account = JSON.parse(localStorage.getItem(key) ?? 'null') as { pass?: unknown } | null;
      return typeof account?.pass === 'string' && account.pass.length > 0;
    }, ACCOUNT_KEY);
    expect(stored, `${ACCOUNT_KEY}.pass in localStorage`).toBe(true);
    recordKnownIssue(`webclient-password-in-localstorage: the client keeps the password in plain text in localStorage (${ACCOUNT_KEY}.pass) and logs in again with it on every page load`);
  });
});
