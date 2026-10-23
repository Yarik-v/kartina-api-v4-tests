import { test, expect, hoverNavDropdown, openHome, secondsPlayed, titleBanner } from './fixtures';

test.describe('radio', () => {
  test('a station from the "Радио" menu opens with its name and plays', { tag: '@UI-09' }, async ({ page }) => {
    await openHome(page);
    await hoverNavDropdown(page, 'Радио');
    const link = page.locator('header a[href^="/radio/"]').first();
    const name = (await link.innerText()).trim();
    const id = (await link.getAttribute('href'))!.match(/^\/radio\/([^/?]+)/)![1];
    const play = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v4/channels/${id}/play`);
    await link.click();
    expect((await play).status(), `GET /channels/${id}/play`).toBe(200);
    await page.waitForURL(`**/radio/${id}**`);
    await expect(titleBanner(page)).toContainText(name);
    await expect.poll(() => secondsPlayed(page), { message: 'seconds of the station played', timeout: 30_000 }).toBeGreaterThan(2);
  });
});
