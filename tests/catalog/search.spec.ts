import { test, expect } from '../fixtures';
import { expectError, expectKnownIssue, expectResponse, recordKnownIssue } from '../../src/assertions';
import { apiPath } from '../../src/client';
import type { SearchFacets, SearchHistory, SearchResults } from '../../src/types';

/** Search results with the card fields the filters act on. */
type FilterResults = Omit<SearchResults, 'items'> & {
  items: { id: string; title: string; year: string | null; ratings: { imdb: number | null; kinopoisk: number | null }; details_url: string }[];
};

const QUERY = 'маша';

test.describe('GET /search/services', () => {
  test('a query returns a page of results with consistent counters', { tag: '@SRCH-01' }, async ({ api }) => {
    const body = await expectResponse<SearchResults>(await api.searchServices({ query: QUERY, limit: 5 }), 'searchServices', 200);
    expect(body.count).toBe(body.items.length);
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThanOrEqual(5);
    expect(body).toMatchObject({ offset: 0, limit: 5 });
    expect(body.total).toBeGreaterThanOrEqual(body.count);
  });

  test('next_url leads to the following page', { tag: '@SRCH-02' }, async ({ api }) => {
    const first = await expectResponse<SearchResults>(await api.searchServices({ query: QUERY, limit: 2 }), 'searchServices', 200);
    test.skip(first.total <= 2, 'Too few results for a second page');
    expect(first.next_url).toBeTruthy();

    const second = await expectResponse<SearchResults>(await api.raw('GET', apiPath(first.next_url!)), 'searchServices', 200);
    expect(second.offset).toBe(2);
    expect(second.total).toBe(first.total);
    const firstIds = first.items.map((item) => `${item.service}/${item.id}`);
    for (const item of second.items) expect(firstIds, 'pages do not overlap').not.toContain(`${item.service}/${item.id}`);
    expect(second.prev_url, 'the second page links back').toBeTruthy();
  });

  test('service narrows the results to that service', { tag: '@SRCH-03' }, async ({ api }) => {
    // A service the unfiltered search does return, so the filtered one can't pass empty.
    const unfiltered = await expectResponse<SearchResults>(await api.searchServices({ query: QUERY, limit: 20 }), 'searchServices', 200);
    const service = unfiltered.items[0]?.service;
    test.skip(!service, 'The search returned nothing to filter');
    const body = await expectResponse<SearchResults>(await api.searchServices({ query: QUERY, service, limit: 10 }), 'searchServices', 200);
    expect(body.count, `results of ${service}`).toBeGreaterThan(0);
    for (const item of body.items) expect(item.service).toBe(service);
  });

  test('with_epg adds TV-guide titles to the search', { tag: '@SRCH-04' }, async ({ api }) => {
    await expectResponse(await api.searchServices({ query: QUERY, with_epg: true, limit: 5 }), 'searchServices', 200);
  });

  test('sort=-year orders the results newest first', { tag: '@SRCH-05' }, async ({ api }) => {
    const body = await expectResponse<Omit<SearchResults, 'items'> & { items: { year: string | null }[] }>(
      await api.searchServices({ sort: '-year', limit: 20 }),
      'searchServices',
      200,
    );
    const years = body.items.map((item) => Number(item.year)).filter((year) => year > 0);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  test('an unknown service answers 400', { tag: '@SRCH-06' }, async ({ api }) => {
    const body = await expectError(await api.searchServices({ service: 'playwright-no-such-service' }), 'searchServices', 400);
    expect(body.error.details.description).toContain('playwright-no-such-service');
  });

  test('limit below 1 answers 400', { tag: '@SRCH-07' }, async ({ api }) => {
    await expectError(await api.searchServices({ limit: 0 }), 'searchServices', 400);
  });

  test('limit above 100 answers 400', { tag: '@SRCH-07' }, async ({ api }) => {
    await expectError(await api.searchServices({ limit: 101 }), 'searchServices', 400);
  });
});

test.describe('search facets', () => {
  test('GET /search/services/genres lists genres with title counts', { tag: '@SRCH-09' }, async ({ api }) => {
    const body = await expectResponse<SearchFacets>(await api.searchServicesGenres(), 'searchServicesGenres', 200);
    expect(body.count).toBe(body.items.length);
    for (const item of body.items) expect(item.count, item.title).toBeGreaterThan(0);
    expect(body.search_url).toContain('{genre}');
  });

  test('a genre from the list filters the search', { tag: '@SRCH-10' }, async ({ api }) => {
    const genres = await expectResponse<SearchFacets>(await api.searchServicesGenres(), 'searchServicesGenres', 200);
    const genre = genres.items[0].title;
    const body = await expectResponse<SearchResults>(
      await api.raw('GET', apiPath(genres.search_url.replace('{genre}', encodeURIComponent(genre)))),
      'searchServices',
      200,
    );
    expect(body.total).toBeGreaterThan(0);
    // An unfiltered search would pass the line above too: every title must be of the genre.
    const titles = body.items.filter((item): item is SearchResults['items'][number] & { genres: string[] } => 'genres' in item);
    expect(titles.length, 'titles on the first page').toBeGreaterThan(0);
    for (const item of titles) expect(item.genres.map((g) => g.toLowerCase()), `${item.service}/${item.id} «${item.title}»`).toContain(genre.toLowerCase());
  });

  // SRCH-08. `director` and `actor` aren't checked: the details of the subscribed
  // services' titles list no directors or actors to search for.
  test('from_year / to_year keep the results within those years', { tag: '@SRCH-08' }, async ({ api }) => {
    const body = await expectResponse<FilterResults>(await api.searchServices({ from_year: 2020, to_year: 2021, limit: 20 }), 'searchServices', 200);
    expect(body.count, 'titles of 2020–2021').toBeGreaterThan(0);
    for (const item of body.items) {
      expect(Number(item.year), `year of «${item.title}»`).toBeGreaterThanOrEqual(2020);
      expect(Number(item.year), `year of «${item.title}»`).toBeLessThanOrEqual(2021);
    }
  });

  for (const [param, rating] of [['imdb_rating_from', 'imdb'], ['kinopoisk_rating_from', 'kinopoisk']] as const) {
    test(`${param} keeps only titles rated that high`, { tag: '@SRCH-08' }, async ({ api }) => {
      const body = await expectResponse<FilterResults>(await api.searchServices({ [param]: 8, limit: 20 }), 'searchServices', 200);
      expect(body.count, `titles rated 8+ on ${rating}`).toBeGreaterThan(0);
      for (const item of body.items) expect(item.ratings[rating], `${rating} rating of «${item.title}»`).toBeGreaterThanOrEqual(8);
    });
  }

  test('country keeps only titles produced there', { tag: '@SRCH-08' }, async ({ api }) => {
    // Cards carry no countries: they're checked in the details.
    const countriesOf = async (item: FilterResults['items'][number]) =>
      (await expectResponse<{ countries: string[] }>(await api.raw('GET', apiPath(item.details_url)), 'getContentDetails', 200)).countries;
    const sample = await expectResponse<FilterResults>(await api.searchServices({ limit: 5 }), 'searchServices', 200);
    let country: string | undefined;
    for (const item of sample.items) if (!country) country = (await countriesOf(item))[0];
    test.skip(!country, 'None of the first titles lists a country');
    const body = await expectResponse<FilterResults>(await api.searchServices({ country: country!, limit: 5 }), 'searchServices', 200);
    expect(body.count, `titles of ${country}`).toBeGreaterThan(0);
    for (const item of body.items) expect(await countriesOf(item), `countries of «${item.title}»`).toContain(country);
  });

  test('search_url breaks its own documented format (known docs bug)', { tag: ['@SRCH-11', '@pinned'] }, async ({ api }) => {
    await expectKnownIssue(await api.searchServicesGenres(), 'searchServicesGenres', 200, 'search-url-template-format');
  });

  test('GET /search/services/countries answers an undocumented 503 E_SYSTEM_ERROR (known API bug)', { tag: ['@SRCH-12', '@pinned'] }, async ({ api }) => {
    // Documented: 200 with the production countries. Staging and production answer an
    // undocumented 503. When it answers 200 this fails; then check it like the genres.
    const res = await api.searchServicesCountries();
    expect(res.status()).toBe(503);
    expect((await res.json()).error.type).toBe('E_SYSTEM_ERROR');
    recordKnownIssue('search-countries-503: GET /search/services/countries answers 503 E_SYSTEM_ERROR, a status it does not document');
  });
});

// The history is the account's own: the suite never clears it or adds a query. It
// only repeats the top query, which by the docs ("a repeat moves to the top") changes
// nothing. Not even a blank query: if stored by mistake, only wiping the history
// would undo it.
test.describe('search history', { tag: '@mutates' }, () => {
  test.describe.configure({ mode: 'default' });

  test('GET /search/history lists the recent queries, lowercased', { tag: '@SRCH-13' }, async ({ api }) => {
    const body = await expectResponse<SearchHistory>(await api.getSearchHistory(), 'getSearchHistory', 200);
    expect(body.count).toBe(body.items.length);
    for (const query of body.items) expect(query).toBe(query.toLowerCase());
    expect(body.history_url).toBe('/api/v4/search/history');
    expect(body.search_url).toContain('{query}');
  });

  test('POST /search/history of the top query, in capitals, stores it lowercased and changes nothing', { tag: '@SRCH-14' }, async ({ api }) => {
    const before = await expectResponse<SearchHistory>(await api.getSearchHistory(), 'getSearchHistory', 200);
    test.skip(before.count === 0, 'The search history is empty; recording a query would add one');

    await expectResponse(await api.addSearchHistoryEntry({ query: before.items[0].toUpperCase() }), 'addSearchHistoryEntry', 201);
    const after = await expectResponse<SearchHistory>(await api.getSearchHistory(), 'getSearchHistory', 200);
    expect(after.items).toEqual(before.items);
  });
});
