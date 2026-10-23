import { apiPath } from '../src/client';
import { expectResponse } from '../src/assertions';
import type { CardList, Page } from '../src/types';
import { test, expect, openHome } from './fixtures';

test.describe('/home — dashboard', () => {
  test('the hero slider shows the first dashboard block, slide for slide', { tag: '@UI-02' }, async ({ page, uiApi }) => {
    await openHome(page);
    const dashboard = await expectResponse<Page>(await uiApi.getPage('dashboard'), 'getPage', 200);
    const first = dashboard.items[0];
    const block = await expectResponse<CardList<{ title: string }>>(
      await uiApi.raw('GET', apiPath(first.block_url)),
      'getPageBlock',
      200,
    );
    expect(block.items.length, `block "${first.title}"`).toBeGreaterThan(0);

    await expect(page.locator('.swiper-slide-active h2')).toHaveText(block.items[0].title);
    await expect(page.getByText(/^\s*\d+ из \d+\s*$/).first()).toHaveText(new RegExp(`^\\s*1 из ${block.items.length}\\s*$`));
  });
});
