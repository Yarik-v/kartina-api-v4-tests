import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import { operationForPath } from '../../src/spec';
import type { Page } from '../../src/types';

test.describe('GET /pages/tv', () => {
  test('lists the TV channel groups, each linking to its own block', async ({ api }) => {
    const body = await expectResponse<Page>(await api.getTvPage(), 'getTvPage', 200);
    expect(body.slug).toBe('tv');
    expect(body.items.length).toBeGreaterThan(0);
    for (const block of body.items) {
      expect(block.type).toBe('channel_group');
      expect(block.block_url).toBe(`/api/v4/pages/tv/channel-groups/${block.id}`);
    }
  });

  test('the groups together hold every channel of GET /channels', async ({ api, channels }) => {
    const body = await expectResponse<Page>(await api.getTvPage(), 'getTvPage', 200);
    const total = body.items.reduce((sum, block) => sum + (block.count ?? 0), 0);
    expect(total).toBe(channels.count);
  });
});

test.describe('GET /pages/radio', () => {
  test('lists the radio channel group', async ({ api }) => {
    const body = await expectResponse<Page>(await api.getRadioPage(), 'getRadioPage', 200);
    expect(body.slug).toBe('radio');
    expect(body.items.map((block) => block.block_url)).toContain('/api/v4/pages/radio/channel-group');
  });
});

test.describe('GET /pages/{slug}', () => {
  test('the dashboard lists its blocks, each linking to a documented block endpoint', async ({ api, dashboard }) => {
    await expectResponse<Page>(await api.getPage(dashboard.slug), 'getPage', 200);
    expect(dashboard.slug).toBe('dashboard');
    expect(dashboard.items.length).toBeGreaterThan(0);
    expect(new Set(dashboard.items.map((block) => block.id)).size, 'unique block ids').toBe(dashboard.items.length);
    for (const block of dashboard.items) {
      // An editor's block lives under the page; personal ones (continue watching,
      // client channels...) at their own /blocks/... address.
      const op = operationForPath('GET', block.block_url);
      expect(op?.path.startsWith('/blocks/') || op?.id === 'getPageBlock', `${block.id}: ${block.block_url}`).toBe(true);
      if (op?.id === 'getPageBlock') expect(block.block_url).toBe(`/api/v4/pages/dashboard/blocks/${block.id}`);
    }
  });

  test('an unknown slug answers 404', async ({ api }) => {
    await expectError(await api.getPage('playwright-no-such-page'), 'getPage', 404);
  });
});
