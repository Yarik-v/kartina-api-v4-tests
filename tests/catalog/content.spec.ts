import { test, expect, findCards } from '../fixtures';
import { expectError, expectResponse, recordKnownIssue } from '../../src/assertions';
import { parameterEnum } from '../../src/spec';
import type { CardList, ContentCard, ContentDetails, PlaybackStream } from '../../src/types';

const DETAILS_SERVICES = parameterEnum('getContentDetails', 'service');
const FREE_EPISODE_SERVICES = parameterEnum('playContentFreeEpisode', 'service');

/** The file a stream URL points at: the same file is served from different streamer hosts. */
const streamFile = (url: string) => (URL.canParse(url) ? new URL(url).pathname : url.split('?')[0]);

const NO_MOVIE = 'No playable movie of a subscribed service on the dashboard right now';
const NO_SERIES = 'No playable series with episodes of a subscribed service on the dashboard right now';

test.describe('GET /content/{service}/{id}', () => {
  test('a movie: the card the dashboard links to, with links back to itself', { tag: '@CNT-01' }, async ({ sampleMovie }) => {
    test.skip(!sampleMovie, NO_MOVIE);
    const { card, details } = sampleMovie!;
    const base = `/api/v4/content/${card.service}/${card.id}`;

    expect(details).toMatchObject({ id: card.id, service: card.service, kind: 'movie' });
    expect(card.details_url).toBe(base);
    expect(details.play_url).toBe(`${base}/play`);
    expect(details.favorite_url).toBe(`${base}/favorite`);
    expect(details.similar_url).toBe(`${base}/similar`);
  });

  test('the details answer matches its documented schema', { tag: ['@CNT-01', '@CNT-02'] }, async ({ api, sampleMovie, sampleSeries }) => {
    test.skip(!sampleMovie && !sampleSeries, NO_MOVIE);
    for (const { card } of [sampleMovie, sampleSeries].filter((t) => t !== null)) {
      await expectResponse(await api.getContentDetails(card.service, card.id), 'getContentDetails', 200);
    }
  });

  test('a series: seasons list their episodes, each with its own play link', { tag: '@CNT-02' }, async ({ sampleSeries }) => {
    test.skip(!sampleSeries, NO_SERIES);
    const { card, details } = sampleSeries!;
    expect(details.kind).toBe('series');
    for (const season of details.seasons) {
      expect(season.episode_count, `season ${season.number}`).toBe(season.episodes.length);
      for (const episode of season.episodes) {
        if (episode.play_url) {
          expect(episode.play_url).toBe(
            `/api/v4/content/${card.service}/${card.id}/seasons/${season.number ?? 0}/episodes/${episode.id}/play`,
          );
        }
      }
    }
  });

  test('an unknown title answers 404', { tag: '@CNT-03' }, async ({ api }) => {
    await expectError(await api.getContentDetails('mediateka', 'playwright-no-such-title'), 'getContentDetails', 404);
  });

  test('an unknown service answers 404', { tag: '@CNT-04' }, async ({ api }) => {
    await expectError(await api.getContentDetails('playwright-no-such-service', '1'), 'getContentDetails', 404);
  });

  test('dashboard cards link to details of services the spec leaves out of {service} (known docs bug)', { tag: ['@CNT-05', '@pinned'] }, async ({
    api,
    dashboardBlocks,
  }) => {
    // The `service` enum of GET /content/{service}/{id} leaves out services the
    // dashboard links to working details of (startru, iviru). Pinned on the spec
    // itself, so editorial changes can't turn it red: once the enum lists them this
    // fails, and the test can go.
    for (const service of ['startru', 'iviru']) expect(DETAILS_SERVICES, 'the documented {service} enum').not.toContain(service);
    // The dashboard showing the details work: only while such cards are on it.
    const outside = findCards(dashboardBlocks, (c) => !DETAILS_SERVICES.includes(c.service));
    test.skip(outside.length === 0, 'No card of a service outside the documented enum is on the dashboard right now');
    const card = outside[0];
    await expectResponse(await api.getContentDetails(card.service, card.id), 'getContentDetails', 200);
    recordKnownIssue(
      `content-service-enum: details_url points at services the {service} enum of GET /content/{service}/{id} leaves out (${[
        ...new Set(outside.map((c) => c.service)),
      ].join(', ')})`,
    );
  });
});

test.describe('GET /content/{service}/{id}/similar', () => {
  test('returns other titles, not the title itself', { tag: '@CNT-06' }, async ({ api, sampleMovie }) => {
    test.skip(!sampleMovie, NO_MOVIE);
    const { card } = sampleMovie!;
    const body = await expectResponse<CardList<ContentCard>>(
      await api.getContentSimilar(card.service, card.id),
      'getContentSimilar',
      200,
    );
    expect(body.count).toBe(body.items.length);
    expect(body.items.map((item) => `${item.service}/${item.id}`)).not.toContain(`${card.service}/${card.id}`);
  });
});

test.describe('playback', () => {
  test('GET .../play of a movie answers with a stream', { tag: '@CNT-07' }, async ({ api, sampleMovie }) => {
    test.skip(!sampleMovie, NO_MOVIE);
    const { card } = sampleMovie!;
    const body = await expectResponse<PlaybackStream>(await api.playContent(card.service, card.id), 'playContent', 200);
    expect(body.url).toBeTruthy();
  });

  test('GET .../episodes/{episodeId}/play of the first episode answers with a stream', { tag: '@CNT-08' }, async ({ api, sampleSeries }) => {
    test.skip(!sampleSeries, NO_SERIES);
    const { card, details } = sampleSeries!;
    const season = details.seasons[0];
    const res = await api.playContentEpisode(card.service, card.id, season.number ?? 0, season.episodes[0].id);
    const body = await expectResponse<PlaybackStream>(res, 'playContentEpisode', 200);
    expect(body.url).toBeTruthy();
  });

  test('an unknown episode answers 404', { tag: '@CNT-09' }, async ({ api, sampleSeries }) => {
    test.skip(!sampleSeries, NO_SERIES);
    const { card } = sampleSeries!;
    await expectError(
      await api.playContentEpisode(card.service, card.id, 1, 'playwright-no-such-episode'),
      'playContentEpisode',
      404,
    );
  });

  test('GET .../trailers/{trailerId}/play answers with the trailer URL only', { tag: '@CNT-10' }, async ({ api, dashboardBlocks }) => {
    const card = findCards(dashboardBlocks, (c) => Boolean(c.trailer_url))[0];
    test.skip(!card, 'No card with a trailer on the dashboard');
    const details = await expectResponse<ContentDetails>(await api.getContentDetails(card.service, card.id), 'getContentDetails', 200);
    const trailer = details.trailers.find((t) => t.play_url === card.trailer_url);
    expect(trailer, 'the card trailer_url is one of the details trailers').toBeDefined();
    expect(trailer!.play_url).toBe(`/api/v4/content/${card.service}/${card.id}/trailers/${trailer!.id}/play`);

    const body = await expectResponse<{ url: string }>(
      await api.playContentTrailer(card.service, card.id, trailer!.id),
      'playContentTrailer',
      200,
    );
    expect(Object.keys(body), 'url only: no markers or vmap').toEqual(['url']);
  });

  test('a title the card marks not playable does not play: 403', { tag: '@CNT-12' }, async ({ api, dashboardBlocks }) => {
    const card = findCards(dashboardBlocks, (c) => !c.playable)[0];
    test.skip(!card, 'Every title on the dashboard is playable for this account');
    await expectError(await api.playContent(card.service, card.id), 'playContent', 403);
  });

  test('an unknown trailer id is not answered with the documented 404 (known API bug)', { tag: ['@CNT-11', '@pinned'] }, async ({ api, dashboardBlocks }) => {
    // Documented: 404 E_WRONG_ID. Live (one title per service, a movie where there is
    // one): most answer an undocumented 503, and some movies 200 with the title's own
    // stream, the very file GET .../play hands out. So the trailer id is ignored;
    // whether .../play's checks are skipped too is worth a look on the API side.
    // Pinned: once no service answers 200 for a made-up trailer this fails.
    const cards = new Map<string, ContentCard>();
    const playable = findCards(dashboardBlocks, (c) => c.playable);
    for (const card of [...playable.filter((c) => c.kind === 'movie'), ...playable]) {
      if (!cards.has(card.service)) cards.set(card.service, card);
    }

    const outcomes: string[] = [];
    const servingTheTitle: string[] = [];
    for (const card of cards.values()) {
      const res = await api.playContentTrailer(card.service, card.id, 'playwright-no-such-trailer');
      outcomes.push(`${card.service}: ${res.status()}`);
      if (res.status() !== 200) continue;
      const trailerFile = streamFile(((await res.json()) as { url: string }).url);
      const play = await api.playContent(card.service, card.id);
      if (play.ok() && streamFile(((await play.json()) as PlaybackStream).url) === trailerFile) servingTheTitle.push(card.service);
    }
    expect(outcomes.some((outcome) => outcome.endsWith(': 200')), outcomes.join(', ')).toBe(true);
    recordKnownIssue(
      `trailer-id-ignored: a made-up trailerId answers ${outcomes.join(', ')}; the stream is the title's own for ${servingTheTitle.join(', ') || 'none'}`,
    );
  });

  test('an unknown title answers 404', { tag: '@CNT-13' }, async ({ api }) => {
    await expectError(await api.playContent('mediateka', 'playwright-no-such-title'), 'playContent', 404);
  });
});

test.describe('GET /content/{service}/free/{id}/play', () => {
  // The series is found on the shared session; the play request itself goes without one.
  test('needs no session: the first episode of a series either plays or is documented as not free', { tag: ['@CNT-14', '@GEN-04'] }, async ({
    api,
    anonApi,
    dashboardBlocks,
  }) => {
    const series = findCards(dashboardBlocks, (c) => c.kind === 'series' && FREE_EPISODE_SERVICES.includes(c.service))[0];
    test.skip(!series, 'No series of a service with free episodes on the dashboard');
    const details = await expectResponse<ContentDetails>(
      await api.getContentDetails(series.service, series.id),
      'getContentDetails',
      200,
    );
    const episode = details.seasons[0]?.episodes[0];
    test.skip(!episode, 'The series lists no episodes');

    const res = await anonApi.playContentFreeEpisode(series.service, episode!.id);
    if (res.status() === 403) await expectError(res, 'playContentFreeEpisode', 403);
    else await expectResponse<PlaybackStream>(res, 'playContentFreeEpisode', 200);
  });

  test('an unknown episode answers 404', { tag: ['@no-session', '@CNT-15', '@GEN-04'] }, async ({ anonApi }) => {
    await expectError(
      await anonApi.playContentFreeEpisode('mediateka', 'playwright-no-such-episode'),
      'playContentFreeEpisode',
      404,
    );
  });
});
