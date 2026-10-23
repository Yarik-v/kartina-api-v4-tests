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
