import { expectResponse } from '../src/assertions';
import type { Account } from '../src/types';
import { test, expect, openPage } from './fixtures';

test.describe('settings', () => {
  test('"Информация об абонементе" shows the login, packet and end date of GET /account', { tag: '@UI-11' }, async ({ page, uiApi }) => {
    await openPage(page, '/settings/account');
    const account = await expectResponse<Account>(await uiApi.getAccount(), 'getAccount', 200);
    // The date as the browser formats it, in its own time zone: "18 сентября 2027".
    const endDate = await page.evaluate((ts) => {
      const parts = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(new Date(ts * 1000));
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      return `${part('day')} ${part('month')} ${part('year')}`;
    }, account.expire_at);

    // "Label: value", with the space only in the rendering (textContent has none).
    const field = (label: string, value: string | number) =>
      new RegExp(`${label}:\\s*${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const info = page.locator('body');
    await expect(info).toContainText(field('Абонемент', account.login));
    await expect(info).toContainText(field('Пакет', account.packet.title));
    await expect(info).toContainText(field('Дата окончания', endDate));
  });
});
