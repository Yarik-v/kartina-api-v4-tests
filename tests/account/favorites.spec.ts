import type { APIResponse } from '@playwright/test';
import { test, expect, findCards, type Undo } from '../fixtures';
import { expectError, expectResponse, recordKnownIssue } from '../../src/assertions';
import type { V4ApiClient } from '../../src/client';
import { operation, parameterEnum } from '../../src/spec';
import type { CardList, ChannelCard, ChannelListCard, ChannelsList, ContentDetails, FavoritesList } from '../../src/types';

// Services each favorites operation documents, from the spec's own enums (GET by
// service lacks startru / iviru, PUT has them).
const LISTABLE_SERVICES = parameterEnum('getFavoritesByService', 'service');
const FAVORABLE_SERVICES = parameterEnum('addContentFavorite', 'service');
/** The aliases PUT / DELETE `/content/{service}/{id}/favorite` document, and their services. */
const SERVICE_ALIASES: Record<string, string> = { ivi: 'iviru', start_film: 'startru', tntpremier: 'premierone', 'film-ua': 'filmua', 'more-tv': 'moretv' };

async function favorites(api: V4ApiClient): Promise<FavoritesList> {
  return expectResponse<FavoritesList>(await api.getFavorites(), 'getFavorites', 200);
}

const contains = (list: FavoritesList, id: string, service?: string) =>
  list.items.some((item) => item.id === id && (!service || item.service === service));

/**
 * Sends the PUT that adds a favorite, its removal registered with `undo` first. A 200
 * means the subscriber already had it, so it stays; otherwise it's removed after the
 * test (a 404 then is fine: the test may have removed it itself).
 */
async function addFavorite(undo: Undo, what: string, put: () => Promise<APIResponse>, remove: () => Promise<APIResponse>): Promise<APIResponse> {
  let wasFavorite = false;
  undo(async () => {
    if (!wasFavorite) expect([204, 404], `remove favorite ${what}`).toContain((await remove()).status());
  });
  const res = await put();
  wasFavorite = res.status() === 200;
  return res;
}
const addTitle = (api: V4ApiClient, undo: Undo, service: string, id: string) =>
  addFavorite(undo, `${service}/${id}`, () => api.addContentFavorite(service, id), () => api.removeContentFavorite(service, id));
const addChannel = (api: V4ApiClient, undo: Undo, id: string) =>
  addFavorite(undo, `channel ${id}`, () => api.addChannelFavorite(id), () => api.removeChannelFavorite(id));

/** A playable channel that isn't a favorite: by the worker's snapshot and by the live list. */
async function nonFavoriteChannel(api: V4ApiClient, channels: ChannelsList): Promise<ChannelListCard | undefined> {
  const live = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
  return [...channels.items].reverse().find((c) => !c.favorite && c.playable && !c.access.protected && !contains(live, c.id));
}

// Favorites are the account's own list: these tests run in api-v4-mutating and take
// back exactly what they add. They only add an item that isn't a favorite (by its
// card and by the live list), through `addFavorite`, which registers the removal
// before the PUT.

test.describe('GET /favorites', { tag: '@mutates' }, () => {
  test('lists channels and titles, all marked favorite', { tag: '@FAV-01' }, async ({ api }) => {
    const body = await favorites(api);
    expect(body.count).toBe(body.items.length);
    for (const item of body.items) expect(item.favorite, `${item.kind} ${item.id}`).toBe(true);
  });

  test('GET /favorites/channels holds only channels, the same ones GET /favorites lists', { tag: '@FAV-02' }, async ({ api }) => {
    const all = await favorites(api);
    const channels = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
    expect(channels.count).toBe(channels.items.length);
    for (const item of channels.items) {
      expect(['channel', 'playlist', 'radio']).toContain(item.kind);
      expect(contains(all, item.id), `channel ${item.id} in GET /favorites`).toBe(true);
    }
  });

  test('GET /favorites/{service} holds only that service\'s titles', { tag: '@FAV-03' }, async ({ api, dashboardBlocks, undo }) => {
    const listable = (service: string) => service !== 'channels' && LISTABLE_SERVICES.includes(service);
    let all = await favorites(api);
    // With no favorite of a service this endpoint lists, the check would pass
    // trivially (0 == 0), so a title is added for the test and taken back.
    if (!all.items.some((item) => item.service && listable(item.service))) {
      const card = findCards(dashboardBlocks, (c) => !c.favorite && listable(c.service) && !contains(all, c.id, c.service)).pop();
      test.skip(!card, 'No title of a service GET /favorites/{service} lists, favorite or not');
      await expectResponse(await addTitle(api, undo, card!.service, card!.id), 'addContentFavorite', 201);
      all = await favorites(api);
    }
    const service = all.items.find((item) => item.service && listable(item.service))!.service!;
    const body = await expectResponse<FavoritesList>(await api.getFavoritesByService(service), 'getFavoritesByService', 200);
    expect(body.count, service).toBeGreaterThan(0);
    expect(body.count).toBe(body.items.length);
    for (const item of body.items) expect(item.service).toBe(service);
    expect(body.count).toBe(all.items.filter((item) => item.service === service).length);
  });

  test('GET /favorites/{service} for a service outside the documented list answers 404', { tag: '@FAV-04' }, async ({ api }) => {
    await expectError(await api.getFavoritesByService('playwright-no-such-service'), 'getFavoritesByService', 404);
  });
});

test.describe('VOD title favorites', { tag: '@mutates' }, () => {
  test('PUT adds a title (201, then 200 when repeated), DELETE removes it (204, then 404)', { tag: '@FAV-05' }, async ({
    api,
    dashboardBlocks,
    undo,
  }) => {
    const before = await favorites(api);
    const card = findCards(
      dashboardBlocks,
      (c) => !c.favorite && FAVORABLE_SERVICES.includes(c.service) && !contains(before, c.id, c.service),
    ).pop();
    test.skip(!card, 'No non-favorite title on the dashboard right now');
    const { service, id } = card!;

    await expectResponse(await addTitle(api, undo, service, id), 'addContentFavorite', 201);
    await expectResponse(await api.addContentFavorite(service, id), 'addContentFavorite', 200);

    expect(contains(await favorites(api), id, service), 'listed in GET /favorites').toBe(true);
    const details = await expectResponse<ContentDetails>(await api.getContentDetails(service, id), 'getContentDetails', 200);
    expect(details.favorite, 'details.favorite').toBe(true);

    await expectResponse(await api.removeContentFavorite(service, id), 'removeContentFavorite', 204);
    await expectError(await api.removeContentFavorite(service, id), 'removeContentFavorite', 404);
    expect(contains(await favorites(api), id, service), 'gone from GET /favorites').toBe(false);
  });
});

test.describe('service aliases', { tag: '@mutates' }, () => {
  test('an alias adds, shows and removes a title as its own service', { tag: '@FAV-07' }, async ({ api, dashboardBlocks, undo }) => {
    const before = await favorites(api);
    const checked: string[] = [];
    for (const [alias, service] of Object.entries(SERVICE_ALIASES)) {
      const card = findCards(dashboardBlocks, (c) => c.service === service && !c.favorite && !contains(before, c.id, service)).pop();
      if (!card) continue;
      const { id } = card;
      const put = await addFavorite(undo, `${service}/${id}`, () => api.addContentFavorite(alias, id), () => api.removeContentFavorite(service, id));
      await expectResponse(put, 'addContentFavorite', 201);
      expect(contains(await favorites(api), id, service), `${alias}/${id} listed as ${service}`).toBe(true);
      const details = await expectResponse<ContentDetails>(await api.getContentDetails(alias, id), 'getContentDetails', 200);
      expect(details.service, `service of GET /content/${alias}/${id}`).toBe(service);
      expect(details.favorite, `favorite of GET /content/${alias}/${id}`).toBe(true);
      await expectResponse(await api.removeContentFavorite(alias, id), 'removeContentFavorite', 204);
      expect(contains(await favorites(api), id, service), `${alias}/${id} gone from GET /favorites`).toBe(false);
      checked.push(alias);
    }
    test.skip(checked.length === 0, 'No non-favorite title of an aliased service on the dashboard');
  });
});

test.describe('channel favorites', { tag: '@mutates' }, () => {
  test('PUT adds a channel (201, then 200), DELETE removes it (204, then 404)', { tag: '@FAV-06' }, async ({
    api,
    channels,
    undo,
  }) => {
    const channel = await nonFavoriteChannel(api, channels);
    test.skip(!channel, 'Every channel is a favorite already');
    const { id } = channel!;

    await expectResponse(await addChannel(api, undo, id), 'addChannelFavorite', 201);
    await expectResponse(await api.addChannelFavorite(id), 'addChannelFavorite', 200);

    const listed = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
    expect(contains(listed, id), 'listed in GET /favorites/channels').toBe(true);
    expect(listed.items.find((item) => item.id === id)!.favorite).toBe(true);

    await expectResponse(await api.removeChannelFavorite(id), 'removeChannelFavorite', 204);
    await expectError(await api.removeChannelFavorite(id), 'removeChannelFavorite', 404);
    const after = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
    expect(contains(after, id), 'gone from GET /favorites/channels').toBe(false);
  });

  test('the "favorite-channels" block does not follow the favorites (known docs bug)', { tag: ['@BLK-22', '@pinned'] }, async ({ api, channels, undo }) => {
    // The summary calls GET /blocks/client-channels the favorite-channels block
    // («Любимые телеканалы»), but its description and the server make it the
    // most-watched channels: a fresh favorite isn't in it. Pinned on the summary:
    // fails once the docs stop calling it favorites.
    expect(operation('getClientChannelsBlock').summary).toContain('favorite-channels');
    const channel = await nonFavoriteChannel(api, channels);
    test.skip(!channel, 'Every channel is a favorite already');
    const { id } = channel!;

    await expectResponse(await addChannel(api, undo, id), 'addChannelFavorite', 201);
    const block = await expectResponse<CardList<ChannelCard>>(await api.getClientChannelsBlock(), 'getClientChannelsBlock', 200);
    expect(block.items.map((item) => item.id), 'a fresh favorite in the block').not.toContain(id);
    recordKnownIssue('client-channels-summary: GET /blocks/client-channels is summarized as favorite channels, but holds the most-watched ones');
  });
});
