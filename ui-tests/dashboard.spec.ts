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

  // Known playtest bug (also in the Free API repo's ui-tests): clicked right after the
  // page loads, "Next slide" can leave the counter out of step with the slide, so this
  // can fail now and then. It's left as it is on purpose.
  test('"Next slide" shows the block\'s second title and moves the counter to 2', { tag: '@UI-18' }, async ({ page, uiApi }) => {
    await openHome(page);
    const dashboard = await expectResponse<Page>(await uiApi.getPage('dashboard'), 'getPage', 200);
    const block = await expectResponse<CardList<{ title: string }>>(
      await uiApi.raw('GET', apiPath(dashboard.items[0].block_url)),
      'getPageBlock',
      200,
    );
    test.skip(block.items.length < 2, 'The slider has a single slide');

    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(page.locator('.swiper-slide-active h2')).toHaveText(block.items[1].title);
    await expect(page.getByText(/^\s*\d+ из \d+\s*$/).first()).toHaveText(new RegExp(`^\\s*2 из ${block.items.length}\\s*$`));
  });
});
