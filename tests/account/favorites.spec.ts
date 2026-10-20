import { test, expect, findCards } from '../fixtures';
import { expectError, expectResponse, recordKnownIssue } from '../../src/assertions';
import type { V4ApiClient } from '../../src/client';
import { operation, parameterEnum } from '../../src/spec';
import type { CardList, ChannelCard, ContentDetails, FavoritesList } from '../../src/types';

// Services each favorites operation documents (GET by service has no startru / iviru,
// PUT has; they're the spec's own enums, not guesses).
const LISTABLE_SERVICES = parameterEnum('getFavoritesByService', 'service');
const FAVORABLE_SERVICES = parameterEnum('addContentFavorite', 'service');

async function favorites(api: V4ApiClient): Promise<FavoritesList> {
  return expectResponse<FavoritesList>(await api.getFavorites(), 'getFavorites', 200);
}

const contains = (list: FavoritesList, id: string, service?: string) =>
  list.items.some((item) => item.id === id && (!service || item.service === service));

// Favorites are the account's own list: these tests run in the api-v4-mutating
// project, and every test takes back exactly what it added: it only adds a title or
// channel that wasn't a favorite before, and removes it again even when an assertion
// fails halfway.
test.describe.configure({ mode: 'default' });

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

  test('GET /favorites/{service} holds only that service\'s titles', { tag: '@FAV-03' }, async ({ api, dashboardBlocks }) => {
    const listable = (service: string) => service !== 'channels' && LISTABLE_SERVICES.includes(service);
    let all = await favorites(api);
    // With no favorite of a service this endpoint lists, the check below would hold
    // trivially (0 == 0); a title is added for the test then, and taken back.
    let added: { service: string; id: string } | null = null;
    if (!all.items.some((item) => item.service && listable(item.service))) {
      const card = findCards(dashboardBlocks, (c) => !c.favorite && listable(c.service)).pop();
      test.skip(!card, 'No title of a service GET /favorites/{service} lists, favorite or not');
      await expectResponse(await api.addContentFavorite(card!.service, card!.id), 'addContentFavorite', 201);
      added = { service: card!.service, id: card!.id };
      all = await favorites(api);
    }
    try {
      const service = all.items.find((item) => item.service && listable(item.service))!.service!;
      const body = await expectResponse<FavoritesList>(await api.getFavoritesByService(service), 'getFavoritesByService', 200);
      expect(body.count, service).toBeGreaterThan(0);
      expect(body.count).toBe(body.items.length);
      for (const item of body.items) expect(item.service).toBe(service);
      expect(body.count).toBe(all.items.filter((item) => item.service === service).length);
    } finally {
      if (added) await api.removeContentFavorite(added.service, added.id);
    }
  });

  test('GET /favorites/{service} for a service outside the documented list answers 404', { tag: '@FAV-04' }, async ({ api }) => {
    await expectError(await api.getFavoritesByService('playwright-no-such-service'), 'getFavoritesByService', 404);
  });
});

test.describe('VOD title favorites', { tag: '@mutates' }, () => {
  test('PUT adds a title (201, then 200 when repeated), DELETE removes it (204, then 404)', { tag: '@FAV-05' }, async ({
    api,
    dashboardBlocks,
    sampleMovie,
    sampleSeries,
  }) => {
    const taken = new Set([sampleMovie?.card.id, sampleSeries?.card.id]);
    // From the far end of the dashboard, away from the titles other files read.
    const card = findCards(dashboardBlocks, (c) => !c.favorite && FAVORABLE_SERVICES.includes(c.service) && !taken.has(c.id)).pop();
    test.skip(!card, 'No non-favorite title on the dashboard right now');
    const { service, id } = card!;
    expect(contains(await favorites(api), id, service), 'not a favorite before the test').toBe(false);

    let added = false;
    try {
      await expectResponse(await api.addContentFavorite(service, id), 'addContentFavorite', 201);
      added = true;
      await expectResponse(await api.addContentFavorite(service, id), 'addContentFavorite', 200);

      expect(contains(await favorites(api), id, service), 'listed in GET /favorites').toBe(true);
      const details = await expectResponse<ContentDetails>(await api.getContentDetails(service, id), 'getContentDetails', 200);
      expect(details.favorite, 'details.favorite').toBe(true);

      await expectResponse(await api.removeContentFavorite(service, id), 'removeContentFavorite', 204);
      added = false;
      await expectError(await api.removeContentFavorite(service, id), 'removeContentFavorite', 404);
      expect(contains(await favorites(api), id, service), 'gone from GET /favorites').toBe(false);
    } finally {
      if (added) await api.removeContentFavorite(service, id);
    }
  });
});

test.describe('channel favorites', { tag: '@mutates' }, () => {
  test('PUT adds a channel (201, then 200), DELETE removes it (204, then 404)', { tag: '@FAV-06' }, async ({
    api,
    channels,
  }) => {
    const channel = [...channels.items].reverse().find((c) => !c.favorite && c.playable && !c.access.protected);
    test.skip(!channel, 'Every channel is a favorite already');
    const { id } = channel!;

    let added = false;
    try {
      await expectResponse(await api.addChannelFavorite(id), 'addChannelFavorite', 201);
      added = true;
      await expectResponse(await api.addChannelFavorite(id), 'addChannelFavorite', 200);

      const listed = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
      expect(contains(listed, id), 'listed in GET /favorites/channels').toBe(true);
      const card = listed.items.find((item) => item.id === id)!;
      expect(card.favorite).toBe(true);

      await expectResponse(await api.removeChannelFavorite(id), 'removeChannelFavorite', 204);
      added = false;
      await expectError(await api.removeChannelFavorite(id), 'removeChannelFavorite', 404);
      const after = await expectResponse<FavoritesList>(await api.getFavoritesByService('channels'), 'getFavoritesByService', 200);
      expect(contains(after, id), 'gone from GET /favorites/channels').toBe(false);
    } finally {
      if (added) await api.removeChannelFavorite(id);
    }
  });

  test('the "favorite-channels" block does not follow the favorites (known docs bug)', { tag: '@BLK-22' }, async ({ api, channels }) => {
    // GET /blocks/client-channels is summarized as "the client's favorite-channels
    // block" (titled «Любимые телеканалы»), but its description, and the server, make
    // it the most-watched channels: a channel just added to the favorites isn't in it.
    // Pinned on the summary: once the docs stop calling it favorites this fails.
    expect(operation('getClientChannelsBlock').summary).toContain('favorite-channels');
    const channel = [...channels.items].reverse().find((c) => !c.favorite && c.playable && !c.access.protected);
    test.skip(!channel, 'Every channel is a favorite already');
    const { id } = channel!;

    let added = false;
    try {
      await expectResponse(await api.addChannelFavorite(id), 'addChannelFavorite', 201);
      added = true;
      const block = await expectResponse<CardList<ChannelCard>>(await api.getClientChannelsBlock(), 'getClientChannelsBlock', 200);
      expect(block.items.map((item) => item.id), 'a fresh favorite in the block').not.toContain(id);
      recordKnownIssue('client-channels-summary: GET /blocks/client-channels is summarized as favorite channels, but holds the most-watched ones');
    } finally {
      if (added) await api.removeChannelFavorite(id);
    }
  });
});
