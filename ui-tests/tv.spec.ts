import { expectResponse, recordKnownIssue } from '../src/assertions';
import type { V4ApiClient } from '../src/client';
import type { CardList, ChannelCard, ChannelEpg, ChannelsList, EpgProgramme } from '../src/types';
import { test, expect, hoverNavDropdown, openHome, openPage, secondsPlayed } from './fixtures';
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

/** A time as the channel page writes it: "8:05", hours without a leading zero. */
const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
const timeRange = (p: EpgProgramme) => `${time(p.starts_at)} - ${time(p.ends_at)}`;

/**
 * Programmes whose row on the channel page can be told apart: the page lists every day
 * of the EPG in one list, so a daily show is on it several times with the same title
 * and hours.
 */
function distinctProgrammes(epg: ChannelEpg): EpgProgramme[] {
  const key = (p: EpgProgramme) => `${p.title} ${timeRange(p)}`;
  const keys = epg.items.map(key);
  return epg.items.filter((p) => keys.filter((k) => k === key(p)).length === 1);
}

/**
 * Clicks a past programme's row on the open channel page and checks that the client
 * plays it through `GET /channels/{id}/{source}/{starts_at}`: the request answers 200,
 * the URL follows, and the video advances.
 */
async function playPastProgramme(page: Page, channelId: string, programme: EpgProgramme, source: 'teleteka' | 'archive'): Promise<void> {
  // As a viewer would: the channel's live stream is playing before a programme is
  // picked (clicked earlier, the client loads the recording but leaves it paused: W4, UI-27).
  await expect.poll(() => secondsPlayed(page), { message: 'the live stream started', timeout: 30_000 }).toBeGreaterThan(0);
  const row = channelRows(page).filter({ hasText: programme.title }).filter({ hasText: timeRange(programme) });
  const path = `/api/v4/channels/${channelId}/${source}/${programme.starts_at}`;
  const res = page.waitForResponse((r) => new URL(r.url()).pathname === path);
  await row.first().click();
  expect((await res).status(), `GET ${path}`).toBe(200);
  await page.waitForURL(`**/tv/channel/${channelId}/${source}/${programme.starts_at}**`);
  // Advancing, not just past some time: the live stream's position may still be on the element.
  const advanced = async () => {
    const before = await secondsPlayed(page);
    await page.waitForTimeout(2_000);
    return (await secondsPlayed(page)) - before;
  };
  await expect.poll(advanced, { message: `seconds the ${source} stream advanced in 2 s`, timeout: 30_000 }).toBeGreaterThan(1);
}

/**
 * The latest programme of the last day that `wanted` accepts and that can be told apart
 * on the channel page, from the first playable unprotected channels. Reads whole EPGs,
 * which takes a while on staging.
 */
async function findPastProgramme(
  uiApi: V4ApiClient,
  wanted: (p: EpgProgramme) => boolean,
): Promise<{ channelId: string; programme: EpgProgramme } | undefined> {
  const channels = await expectResponse<ChannelsList>(await uiApi.getChannels(), 'getChannels', 200);
  const now = Date.now() / 1000;
  for (const channel of channels.items.filter((c) => c.playable && !c.access.protected).slice(0, 10)) {
    const epg = await expectResponse<ChannelEpg>(await uiApi.getChannelEpg(channel.id), 'getChannelEpg', 200);
    const programme = distinctProgrammes(epg)
      .filter((p) => p.playable && p.ends_at < now && p.starts_at > now - 24 * 60 * 60 && wanted(p))
      .at(-1);
    if (programme) return { channelId: channel.id, programme };
  }
  return undefined;
}

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
    // Waiting for the live stream and then the recording can take a minute on staging.
    test.slow();
    await openFirstChannelGroup(page);
    await channelRows(page).first().click();
    await page.waitForURL(/\/tv\/channel\/[^/]+\/live/);
    const channelId = page.url().match(/\/tv\/channel\/([^/]+)\/live/)![1];
    const epg = await expectResponse<ChannelEpg>(await uiApi.getChannelEpg(channelId), 'getChannelEpg', 200);
    const now = Date.now() / 1000;
    const recorded = distinctProgrammes(epg).filter((p) => p.teleteka && p.ends_at < now).at(-1);
    test.skip(!recorded, `Channel ${channelId} has no recorded programme that can be told apart on the list`);
    await playPastProgramme(page, channelId, recorded!, 'teleteka');
  });

  test('a past programme without a teleteka recording plays from the channel archive', { tag: '@UI-15' }, async ({ page, uiApi }) => {
    // Unlike the API's teleteka of such a programme (a stub clip, bug A2), the client
    // asks for the channel's archive instead.
    test.slow();
    await openHome(page);
    const found = await findPastProgramme(uiApi, (p) => !p.teleteka);
    test.skip(!found, 'None of the first channels has a past programme of the last day without a teleteka recording');

    await openPage(page, `/tv/channel/${found!.channelId}/live`);
    await playPastProgramme(page, found!.channelId, found!.programme, 'archive');
  });

  // Pinned: once a programme picked before the live stream starts plays, this fails;
  // then flip it to the documented behaviour.
  test('a past programme picked before the live stream starts stays paused (known client bug)', { tag: ['@UI-27', '@pinned'] }, async ({ page, uiApi }) => {
    test.slow();
    await openHome(page);
    const found = await findPastProgramme(uiApi, () => true);
    test.skip(!found, 'None of the first channels has a past programme of the last day that can be told apart on the list');
    const { channelId, programme } = found!;

    await openPage(page, `/tv/channel/${channelId}/live`);
    const row = channelRows(page).filter({ hasText: programme.title }).filter({ hasText: timeRange(programme) }).first();
    await row.waitFor();
    test.skip((await secondsPlayed(page)) > 0, 'The live stream started before the programme could be picked');
    const path = new RegExp(`^/api/v4/channels/${channelId}/(archive|teleteka)/${programme.starts_at}$`);
    const res = page.waitForResponse((r) => path.test(new URL(r.url()).pathname));
    await row.click();
    expect((await res).status(), `GET …/${programme.starts_at} of channel ${channelId}`).toBe(200);
    await page.waitForURL(new RegExp(`/tv/channel/${channelId}/(archive|teleteka)/${programme.starts_at}`));

    // The recording loads in full (HAVE_ENOUGH_DATA) ...
    const loaded = () => page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => v.currentSrc !== '' && v.readyState === 4));
    await expect.poll(loaded, { message: 'the recording loaded', timeout: 30_000 }).toBe(true);
    // ... but doesn't start.
    await page.waitForTimeout(10_000);
    expect(await secondsPlayed(page), 'seconds of the recording played 10 s after it loaded').toBe(0);
    recordKnownIssue(`webclient-recording-paused: a past programme picked on the channel page before the live stream starts loads but stays paused (channel ${channelId}, ${programme.starts_at})`);
  });
});
