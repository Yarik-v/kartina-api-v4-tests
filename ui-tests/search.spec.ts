import { expectResponse } from '../src/assertions';
import type { SearchHistory } from '../src/types';
import { test, expect, openPage } from './fixtures';

// Every search in the client is also POSTed to the account's search history, and a
// stored query can only be taken back by clearing the whole history. So this searches
// for the history's top query only: by the docs a repeat moves it to the top, where it
// already is, and changes nothing (checked below).
test.describe('search', () => {
  test('searching for the top history query shows its results and leaves the history as it was', { tag: '@UI-10' }, async ({ page, uiApi }) => {
    await openPage(page, '/home');
    const before = await expectResponse<SearchHistory>(await uiApi.getSearchHistory(), 'getSearchHistory', 200);
    test.skip(before.items.length === 0, 'The search history is empty: any search would add to it');
    const query = before.items[0];

    const searched = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v4/search/services' && new URL(res.url()).searchParams.get('query') === query);
    await openPage(page, `/search?q=${encodeURIComponent(query)}`);
    expect((await searched).status(), 'GET /search/services from the page').toBe(200);
    // The same search as the page's (GET /search/services stores nothing; the page's POST /search/history does).
    const body = await expectResponse<{ items: { title: string }[] }>(
      await uiApi.searchServices({ query, limit: 60, with_epg: true }),
      'searchServices',
      200,
    );
    await expect(page.getByText(`Результаты поиска "${query}"`)).toBeVisible();
    if (body.items.length) await expect(page.getByText(body.items[0].title, { exact: true }).first()).toBeVisible();

    const after = await expectResponse<SearchHistory>(await uiApi.getSearchHistory(), 'getSearchHistory', 200);
    expect(after.items, 'the search history').toEqual(before.items);
  });
});
