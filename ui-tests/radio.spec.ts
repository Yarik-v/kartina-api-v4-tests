import { recordKnownIssue } from '../src/assertions';
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

  test('the play button stops the station', { tag: '@UI-24' }, async ({ page }) => {
    await openHome(page);
    await hoverNavDropdown(page, 'Радио');
    await page.locator('header a[href^="/radio/"]').first().click();
    await page.waitForURL(/\/radio\//);
    await expect.poll(() => secondsPlayed(page), { message: 'the station started', timeout: 30_000 }).toBeGreaterThan(1);

    // The button's icon turns from "stop" to "play".
    const button = page.locator('.play-button');
    const icon = await button.locator('svg path').first().getAttribute('d');
    await button.click();
    await expect.poll(() => button.locator('svg path').first().getAttribute('d'), { message: 'the button icon' }).not.toBe(icon);
    // Stopped: nothing advances any more.
    const before = await secondsPlayed(page);
    await page.waitForTimeout(3_000);
    expect(await secondsPlayed(page), 'seconds played 3 s after stopping').toBeLessThanOrEqual(before);
    // Its tooltip still says "stop" once stopped (known client bug W2).
    if ((await button.getAttribute('title')) === 'Остановить воспроизведение') {
      recordKnownIssue('webclient-radio-stop-tooltip: the stopped station\'s play button still has the tooltip «Остановить воспроизведение»');
    }
  });
});
