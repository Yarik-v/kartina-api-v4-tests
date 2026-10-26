import { expectResponse } from '../src/assertions';
import type { ContentDetails } from '../src/types';
import { test, expect, openFirstTitleDetails, openHome, secondsPlayed, titleBanner, titleHeading, WATCH_BUTTON_NAME } from './fixtures';

test.describe('title page', () => {
  test('shows the title, year and genres GET /content/{service}/{id} returns', { tag: '@UI-03' }, async ({ page, uiApi }) => {
    await openHome(page);
    const { service, id } = await openFirstTitleDetails(page);
    const details = await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200);

    await expect(titleHeading(page)).toHaveText(details.title.display);
    if (details.year) await expect(titleBanner(page)).toContainText(details.year);
    for (const genre of details.genres) await expect(titleBanner(page), `genre ${genre}`).toContainText(genre, { ignoreCase: true });
  });
});

test.describe('title page tabs', () => {
  test('the «Описание» tab shows the description and cast GET /content/{service}/{id} returns', { tag: '@UI-19' }, async ({ page, uiApi }) => {
    await openHome(page);
    const { service, id } = await openFirstTitleDetails(page);
    const details = await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200);

    await page.locator('.tabs .item', { hasText: /^\s*Описание\s*$/ }).click();
    await expect(page.getByText(details.description.full.slice(0, 60)).filter({ visible: true }).first()).toBeVisible();
    if (details.actors.length) {
      const cast = page.getByText('Актеры:', { exact: true }).locator('xpath=..');
      for (const actor of details.actors.slice(0, 3)) await expect(cast, `actor ${actor}`).toContainText(actor);
    }
  });

  test('the «Трейлеры» tab is there exactly when the title has trailers, and opens in place', { tag: '@UI-20' }, async ({ page, uiApi }) => {
    await openHome(page);
    const { service, id } = await openFirstTitleDetails(page);
    const details = await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200);
    const tab = page.locator('.tabs .item', { hasText: /^\s*Трейлеры\s*$/ });
    if (!details.trailers.length) {
      // The tab shows up a few seconds after the rest of the page when there is one.
      await page.waitForTimeout(8_000);
      await expect(tab, `${service}/${id} has no trailers`).toHaveCount(0);
      return;
    }
    const url = page.url();
    await tab.click();
    await expect(page.locator('.tabs .item.active', { hasText: 'Трейлеры' })).toBeVisible();
    expect(page.url(), 'the tab opens in place').toBe(url);
  });

  test('the back button returns to the dashboard', { tag: '@UI-21' }, async ({ page }) => {
    await openHome(page);
    await openFirstTitleDetails(page);
    await titleBanner(page).locator('.btn--back').click();
    await page.waitForURL('**/home');
  });
});

test.describe('player', () => {
  test('the watch button starts the title: GET …/play answers 200 and the video advances', { tag: '@UI-04' }, async ({ page, uiApi }) => {
    await openHome(page);
    const { service, id } = await openFirstTitleDetails(page);
    const details = await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200);
    test.skip(!details.playable, `${service}/${id} is not playable for this account`);

    const play = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/v4/content/${service}/${id}/play`);
    await page.getByRole('button', { name: WATCH_BUTTON_NAME }).click();
    expect((await play).status(), `GET /content/${service}/${id}/play`).toBe(200);
    await page.waitForURL(/\/watch\//);
    await expect.poll(() => secondsPlayed(page), { message: 'seconds of video played', timeout: 30_000 }).toBeGreaterThan(2);
  });
});
