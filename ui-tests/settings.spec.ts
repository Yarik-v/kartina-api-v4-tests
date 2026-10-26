import { expectResponse } from '../src/assertions';
import type { Account, ClientSettings, Setting } from '../src/types';
import { test, expect, openPage } from './fixtures';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    const field = (label: string, value: string | number) => new RegExp(`${label}:\\s*${escapeRegExp(String(value))}`);
    const info = page.locator('body');
    await expect(info).toContainText(field('Абонемент', account.login));
    await expect(info).toContainText(field('Пакет', account.packet.title));
    await expect(info).toContainText(field('Дата окончания', endDate));
  });

  test('"Настройки вещания" show the server and delay GET /settings holds for the browser', { tag: '@UI-14' }, async ({ page, uiApi }) => {
    // Settings belong to the session's device: here the browser's own, read on its session.
    await openPage(page, '/settings/streaming-settings');
    const settings = await expectResponse<ClientSettings>(await uiApi.getSettings(), 'getSettings', 200);
    const label = (setting: Setting) => setting.allowed.find((option) => option.value === setting.value)?.label;
    const server = label(settings.server);
    const delay = label(settings.timeshift);
    expect(server, 'the server setting has a label for its value').toBeDefined();
    expect(delay, 'the timeshift setting has a label for its value').toBeDefined();

    const body = page.locator('body');
    await expect(body).toContainText(new RegExp(`Сервер вещания\\s*${escapeRegExp(server!)}`));
    await expect(body).toContainText(new RegExp(`Задержка вещания в часах\\s*${escapeRegExp(delay!)}`));
  });
});
