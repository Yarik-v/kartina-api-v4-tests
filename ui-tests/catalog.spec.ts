import { expectResponse } from '../src/assertions';
import { apiPath } from '../src/client';
import type { Page as ApiPage } from '../src/types';
import { test, expect, hoverNavDropdown, openHome } from './fixtures';

// The catalogs the Free API repo's ui-tests open too, picked by id: two menu entries
// share the name "Медиатека".
const SERVICES = [
  { name: 'START', id: 'startru' },
  { name: 'Wink', id: 'moretv' },
  { name: 'PREMIER', id: 'premierone' },
];

test.describe('service catalogs', () => {
  for (const service of SERVICES) {
    test(`${service.name}: the catalog shows the rows of the service's page`, { tag: '@UI-23' }, async ({ page, uiApi }) => {
      await openHome(page);
      // As the client does: the service's page first (its slug isn't the service id, e.g. more-tv), then the page.
      const pages = await expectResponse<{ pages: { page_url: string }[] }>(await uiApi.getServicePages(service.id), 'getServicePages', 200);
      const catalog = await expectResponse<ApiPage>(await uiApi.raw('GET', apiPath(pages.pages[0].page_url)), 'getPage', 200);
      // The titled rows; the slider and "Продолжить просмотр" are blocks of their own kinds.
      const rows = catalog.items.filter((block) => block.type === 'list');
      expect(rows.length, pages.pages[0].page_url).toBeGreaterThan(0);

      // A cold load of /vod/{service} bounces to /home: the route only works from in-app navigation.
      await hoverNavDropdown(page, 'Видеотека');
      await page.locator(`header a[href="/vod/${service.id}"]`).click();
      await page.waitForURL(`**/vod/${service.id}`);
      for (const block of rows.slice(0, 2)) {
        await expect(page.locator('.block-title', { hasText: new RegExp(`^\\s*${block.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }), `row «${block.title}»`).toBeVisible();
      }
    });
  }
});
