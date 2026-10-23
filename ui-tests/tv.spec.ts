import { expectResponse } from '../src/assertions';
import type { CardList, ChannelCard, ChannelEpg } from '../src/types';
import { test, expect, hoverNavDropdown, openHome, secondsPlayed } from './fixtures';
import type { Page } from '@playwright/test';

/** Opens the first channel group of the "Телевидение" menu; returns its id. */
async function openFirstChannelGroup(page: Page): Promise<string> {
  await openHome(page);
  await hoverNavDropdown(page, 'Телевидение');
  const link = page.locator('header a[href^="/tv/group/"]').first();
  const id = (await link.getAttribute('href'))!.split('/').pop()!;
  await link.click();
  await page.waitForURL(`**/tv/group/${id}`);
  return id;
}

const channelRows = (page: Page) => page.locator('.video-list__item');

test.describe('TV', () => {
  test('a channel group lists the channels GET /pages/tv/channel-groups/{id} returns, in order', { tag: '@UI-06' }, async ({ page, uiApi }) => {
    const id = await openFirstChannelGroup(page);
    const group = await expectResponse<CardList<ChannelCard>>(await uiApi.getTvChannelGroupBlock(id), 'getTvChannelGroupBlock', 200);
    expect(group.items.length, `group ${id}`).toBeGreaterThan(0);
    await expect(channelRows(page).locator('h5.name')).toHaveText(group.items.map((channel) => channel.title));
  });

  test('a channel from the group plays live: GET /channels/{id}/play answers 200 and the video advances', { tag: '@UI-07' }, async ({ page }) => {
    await openFirstChannelGroup(page);
    const play = page.waitForResponse((res) => /\/api\/v4\/channels\/[^/]+\/play$/.test(new URL(res.url()).pathname));
    await channelRows(page).first().click();
    expect((await play).status(), 'GET /channels/{id}/play').toBe(200);
    await page.waitForURL(/\/tv\/channel\/[^/]+\/live/);
    await expect.poll(() => secondsPlayed(page), { message: 'seconds of live video played', timeout: 30_000 }).toBeGreaterThan(2);
  });

  test('the channel page shows the programme on air by GET /channels/{id}/epg', { tag: '@UI-08' }, async ({ page, uiApi }) => {
    await openFirstChannelGroup(page);
    await channelRows(page).first().click();
    await page.waitForURL(/\/tv\/channel\/[^/]+\/live/);
    const channelId = page.url().match(/\/tv\/channel\/([^/]+)\/live/)![1];
    const epg = await expectResponse<ChannelEpg>(await uiApi.getChannelEpg(channelId), 'getChannelEpg', 200);
    const now = Date.now() / 1000;
    const onAir = epg.items.find((programme) => programme.starts_at <= now && now < programme.ends_at);
    test.skip(!onAir, `The EPG of channel ${channelId} has no programme on air right now`);
    // The page adds the episode to the EPG title ("Свет в окне. Серия 4"), and a hidden
    // copy of the text is in the DOM too.
    await expect(page.getByText(onAir!.title).filter({ visible: true }).first()).toBeVisible();
  });

  test('a recorded programme opens from the channel page and plays from the teleteka', { tag: '@UI-12' }, async ({ page, uiApi }) => {
    await openFirstChannelGroup(page);
    await channelRows(page).first().click();
    await page.waitForURL(/\/tv\/channel\/[^/]+\/live/);
    const channelId = page.url().match(/\/tv\/channel\/([^/]+)\/live/)![1];
    const epg = await expectResponse<ChannelEpg>(await uiApi.getChannelEpg(channelId), 'getChannelEpg', 200);
    const now = Date.now() / 1000;
    // The page lists every day of the EPG in one list, so a daily show is on it several
    // times with the same title and hours: the programme is one whose title and time
    // range are unique, so that its row can be told apart.
    // As the page writes it: "8:05", hours without a leading zero.
    const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
    const rowKey = (p: { title: string; starts_at: number; ends_at: number }) => `${p.title} ${time(p.starts_at)} - ${time(p.ends_at)}`;
    const keys = epg.items.map(rowKey);
    const recorded = epg.items
      .filter((p) => p.teleteka && p.ends_at < now && keys.filter((key) => key === rowKey(p)).length === 1)
      .at(-1);
    test.skip(!recorded, `Channel ${channelId} has no recorded programme that can be told apart on the list`);

    const row = channelRows(page).filter({ hasText: recorded!.title }).filter({ hasText: `${time(recorded!.starts_at)} - ${time(recorded!.ends_at)}` });
    const teletekaPath = `/api/v4/channels/${channelId}/teleteka/${recorded!.starts_at}`;
    const teleteka = page.waitForResponse((res) => new URL(res.url()).pathname === teletekaPath);
    await row.first().click();
    expect((await teleteka).status(), `GET ${teletekaPath}`).toBe(200);
    await page.waitForURL(`**/tv/channel/${channelId}/teleteka/${recorded!.starts_at}**`);
    await expect.poll(() => secondsPlayed(page), { message: 'seconds of the recording played', timeout: 30_000 }).toBeGreaterThan(2);
  });
});
