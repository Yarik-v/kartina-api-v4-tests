import { test, expect } from '../fixtures';
import { expectError, expectKnownIssue, expectResponse, recordKnownIssue } from '../../src/assertions';
import type { Block, CardList, ChannelCard, Page } from '../../src/types';

interface PlaybackItem {
  id: string;
  kind: string;
  service: string;
}

test.describe('GET /pages/{slug}/blocks/{id}', () => {
  test('every dashboard block matches the schema of the operation its block_url names, and counts its own items', { tag: '@BLK-01' }, async ({
    dashboardBlocks,
  }) => {
    for (const { res, body, summary, operationId } of dashboardBlocks) {
      await expectResponse<Block>(res, operationId, 200);
      expect(body.count, summary.block_url).toBe(body.items.length);
    }
  });

  test('a page block answers with the id and type the page lists it under', { tag: '@BLK-02' }, async ({ dashboardBlocks }) => {
    const pageBlocks = dashboardBlocks.filter((block) => block.operationId === 'getPageBlock');
    expect(pageBlocks.length).toBeGreaterThan(0);
    for (const { body, summary } of pageBlocks) {
      expect(body.id).toBe(summary.id);
      expect(body.type).toBe(summary.type);
    }
  });

  test('an unknown block id answers an undocumented 503 instead of 404 (known API bug)', { tag: '@BLK-03' }, async ({ api }) => {
    // Documented: 404 for an unknown block. The server answers 503 E_SYSTEM_ERROR,
    // a status the operation doesn't document. Pinned: a fix turns this red; then
    // assert the 404 with expectError instead.
    const res = await api.getPageBlock('dashboard', 'playwright-no-such-block');
    expect(res.status()).toBe(503);
    expect((await res.json()).error.type).toBe('E_SYSTEM_ERROR');
    recordKnownIssue('page-block-unknown-503: GET /pages/{slug}/blocks/{id} answers 503 E_SYSTEM_ERROR for an unknown block, not the documented 404');
  });

  test('an unknown page answers 404', { tag: '@BLK-04' }, async ({ api, dashboard }) => {
    const block = dashboard.items.find((summary) => summary.block_url.startsWith('/api/v4/pages/dashboard/blocks/'))!;
    await expectError(await api.getPageBlock('playwright-no-such-page', block.id), 'getPageBlock', 404);
  });
});

test.describe('GET /pages/{slug}/blocks/{id}/{link}', () => {
  test('an ivi / start_film block redirects to its link target with title and type added', { tag: '@BLK-05' }, async ({ api, dashboardBlocks }) => {
    const block = dashboardBlocks.find(({ body, operationId }) => operationId === 'getPageBlock' && ['ivi', 'start_film'].includes(body.type));
    test.skip(!block, 'The dashboard has no ivi / start_film block right now');
    const res = await api.followPageBlockLink('dashboard', block!.body.id, 'fetch');
    await expectResponse(res, 'followPageBlockLink', 302);
    const location = new URL(res.headers()['location'], 'https://example.invalid/');
    expect(location.searchParams.get('type')).toBe(block!.body.type);
    expect(location.searchParams.get('title')).toBe(block!.body.title);
  });

  test('an unknown link of a block answers 404 E_WRONG_ID', { tag: '@BLK-06' }, async ({ api, dashboard }) => {
    const block = dashboard.items.find((summary) => summary.block_url.startsWith('/api/v4/pages/dashboard/blocks/'))!;
    await expectError(
      await api.followPageBlockLink('dashboard', block.id, 'playwright-no-such-link'),
      'followPageBlockLink',
      404,
      'E_WRONG_ID',
    );
  });

  test('a link of an unknown block answers 503 instead of the documented 404 (known API bug)', { tag: '@BLK-07' }, async ({ api }) => {
    // Documented: 404 E_SYSTEM_ERROR for an unknown block. The server answers 503
    // (the same E_SYSTEM_ERROR), which the operation doesn't document; same cause as
    // the unknown page block above. Pinned: a fix turns this red.
    const res = await api.followPageBlockLink('dashboard', 'playwright-no-such-block', 'fetch');
    expect(res.status()).toBe(503);
    expect((await res.json()).error.type).toBe('E_SYSTEM_ERROR');
    recordKnownIssue('block-link-unknown-503: GET /pages/{slug}/blocks/{id}/{link} answers 503 for an unknown block, not the documented 404');
  });
});

test.describe('GET /blocks/playback', () => {
  test('the continue-watching block: TV programmes and VOD titles, each resumable', { tag: '@BLK-08' }, async ({ api }) => {
    const body = await expectResponse<CardList<PlaybackItem & { play_url: string }>>(
      await api.getPlaybackBlock(),
      'getPlaybackBlock',
      200,
    );
    expect(body).toMatchObject({ id: 'playback', type: 'playback' });
    expect(body.count).toBe(body.items.length);
    expect(body.count).toBeLessThanOrEqual(20);
    for (const item of body.items) expect(item.play_url, `${item.kind} ${item.id}`).toBeTruthy();
  });

  test('limit caps the items and title overrides the block title', { tag: '@BLK-09' }, async ({ api }) => {
    const body = await expectResponse<CardList<PlaybackItem>>(
      await api.getPlaybackBlock({ limit: 1, title: 'Playwright' }),
      'getPlaybackBlock',
      200,
    );
    expect(body.title).toBe('Playwright');
    expect(body.count).toBeLessThanOrEqual(1);
  });

  test('limit outside 1–100 is not rejected with the documented 400 (known API bug)', { tag: '@BLK-10' }, async ({ api }) => {
    // The limit parameter is documented as 1–100 and the operation documents 400 for
    // invalid input; GET /search/services does reject its out-of-range limit, this
    // one answers 200. Pinned: a fix turns this red.
    for (const limit of [0, 101]) expect((await api.getPlaybackBlock({ limit })).status(), `limit=${limit}`).toBe(200);
    recordKnownIssue('playback-limit-unchecked: GET /blocks/playback accepts limit=0 and limit=101 (documented range 1–100) with 200');
  });

  test('GET /blocks/playback/channels holds only TV programmes', { tag: '@BLK-11' }, async ({ api }) => {
    const body = await expectResponse<CardList<PlaybackItem>>(
      await api.getPlaybackBlockByOrigin('channels'),
      'getPlaybackBlockByOrigin',
      200,
    );
    for (const item of body.items) expect(item).toMatchObject({ kind: 'program', service: 'channels' });
  });

  test('GET /blocks/playback/{service} holds only that service\'s titles', { tag: '@BLK-12' }, async ({ api }) => {
    const body = await expectResponse<CardList<PlaybackItem>>(
      await api.getPlaybackBlockByOrigin('premierone'),
      'getPlaybackBlockByOrigin',
      200,
    );
    for (const item of body.items) expect(item.service).toBe('premierone');
  });

  test('an origin outside the documented list answers 404', { tag: '@BLK-13' }, async ({ api }) => {
    await expectError(await api.getPlaybackBlockByOrigin('playwright-no-such-origin'), 'getPlaybackBlockByOrigin', 404);
  });
});

test.describe('personal blocks', () => {
  for (const [operationId, call] of [
    ['getWatchingNowBlock', 'getWatchingNowBlock'],
    ['getRecommendationsBlock', 'getRecommendationsBlock'],
    ['getClientChannelsBlock', 'getClientChannelsBlock'],
    ['getLastNewsBlock', 'getLastNewsBlock'],
  ] as const) {
    test(`${operationId} matches its schema and counts its own items`, { tag: '@BLK-15' }, async ({ api }) => {
      const body = await expectResponse<CardList<unknown>>(await api[call](), operationId, 200);
      expect(body.count).toBe(body.items.length);
    });
  }

  test('watching-now holds at most 25 titles', { tag: '@BLK-16' }, async ({ api }) => {
    const body = await expectResponse<CardList<unknown>>(await api.getWatchingNowBlock(), 'getWatchingNowBlock', 200);
    expect(body.count).toBeLessThanOrEqual(25);
  });

  test('client-channels holds at most 20 channels', { tag: '@BLK-17' }, async ({ api }) => {
    const body = await expectResponse<CardList<unknown>>(await api.getClientChannelsBlock(), 'getClientChannelsBlock', 200);
    expect(body.count).toBeLessThanOrEqual(20);
  });
});

test.describe('channel group blocks', () => {
  test('every TV channel group answers with the channels the TV page counts for it', { tag: '@BLK-18' }, async ({ api }) => {
    const tv = await expectResponse<Page>(await api.getTvPage(), 'getTvPage', 200);
    for (const summary of tv.items) {
      const body = await expectResponse<CardList<ChannelCard>>(
        await api.getTvChannelGroupBlock(summary.id),
        'getTvChannelGroupBlock',
        200,
      );
      expect(body.id).toBe(summary.id);
      expect(body.count, `group ${summary.id}`).toBe(body.items.length);
      expect(body.count, `group ${summary.id} count on the TV page`).toBe(summary.count);
    }
  });

  test('an unknown TV channel group answers 404', { tag: '@BLK-19' }, async ({ api }) => {
    await expectError(await api.getTvChannelGroupBlock('999999'), 'getTvChannelGroupBlock', 404);
  });

  test('the radio channel group lists playable stations', { tag: '@BLK-20' }, async ({ api }) => {
    const body = await expectResponse<CardList<ChannelCard>>(
      await api.getRadioChannelGroupBlock(),
      'getRadioChannelGroupBlock',
      200,
    );
    expect(body.count).toBe(body.items.length);
    expect(body.items.some((item) => item.playable)).toBe(true);
  });

  test('radio stations come with kind "channel" (known API bug)', { tag: '@BLK-21' }, async ({ api }) => {
    await expectKnownIssue(await api.getRadioChannelGroupBlock(), 'getRadioChannelGroupBlock', 200, 'radio-group-channel-kind');
  });
});
