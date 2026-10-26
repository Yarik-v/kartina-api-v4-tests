import { expectResponse } from '../src/assertions';
import type { ContentDetails, FavoritesList } from '../src/types';
import { test, expect, openFirstTitleDetails, openHome, titleBanner, titleHeading } from './fixtures';

// Changes the account's favorites, so the browser projects run after api-v4-mutating;
// the title is taken back through the API also when the test fails halfway.
test.describe('favorites', { tag: '@mutates' }, () => {
  test('the banner button adds the title to the favorites and removes it again', { tag: '@UI-05' }, async ({ page, uiApi, undo }) => {
    await openHome(page);
    const { service, id } = await openFirstTitleDetails(page);
    const details = await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200);
    test.skip(details.favorite, `${service}/${id} is a favorite of the subscriber already`);
    undo(async () => {
      expect([204, 404], `remove favorite ${service}/${id}`).toContain((await uiApi.removeContentFavorite(service, id)).status());
    });
    const favorite = async () =>
      (await expectResponse<ContentDetails>(await uiApi.getContentDetails(service, id), 'getContentDetails', 200)).favorite;
    const toggle = titleBanner(page).locator('button[title*="збранн"]');
    const favoritePath = `/api/v4/content/${service}/${id}/favorite`;
    const call = (method: string) => page.waitForResponse((res) => new URL(res.url()).pathname === favoritePath && res.request().method() === method);

    await expect(toggle).toHaveAttribute('title', 'Добавить в избранное');
    const put = call('PUT');
    await toggle.click();
    expect((await put).status(), `PUT ${favoritePath}`).toBe(201);
    await expect(toggle).not.toHaveAttribute('title', 'Добавить в избранное');
    expect(await favorite(), 'favorite by GET /content after adding').toBe(true);

    const del = call('DELETE');
    await toggle.click();
    expect((await del).status(), `DELETE ${favoritePath}`).toBe(204);
    await expect(toggle).toHaveAttribute('title', 'Добавить в избранное');
    expect(await favorite(), 'favorite by GET /content after removing').toBe(false);
  });
});

test.describe('favorites page', () => {
  test('«Избранное» shows the titles GET /favorites lists, and opens one', { tag: '@UI-22' }, async ({ page, uiApi }) => {
    await openHome(page);
    const favorites = await expectResponse<FavoritesList>(await uiApi.getFavorites(), 'getFavorites', 200);
    const titles = favorites.items.filter((item) => item.kind === 'movie' || item.kind === 'series').map((item) => item.title);
    test.skip(titles.length === 0, 'The account has no favorite titles right now');

    await page.getByRole('link', { name: 'Избранное' }).first().click();
    await page.waitForURL('**/favorites');
    const tiles = page.locator('.video-grid__item');
    for (const title of titles) await expect(tiles.filter({ hasText: title }), `tile «${title}»`).toHaveCount(1);

    await tiles.filter({ hasText: titles[0] }).click();
    await page.waitForURL(/\/favorites\/itm/);
    await expect(titleHeading(page)).toHaveText(titles[0]);
  });
});
