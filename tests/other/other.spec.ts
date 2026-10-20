import { test, expect } from '../fixtures';
import { expectResponse } from '../../src/assertions';
import { operation } from '../../src/spec';

test.describe('GET /servertime', { tag: '@no-session' }, () => {
  test('needs no session and reports the current time, the same as X-Api-Servertime', async ({ anonApi }) => {
    expect(operation('getServertime').requiresSession).toBe(false);
    const res = await anonApi.getServertime();
    const body = await expectResponse<{ servertime: number }>(res, 'getServertime', 200);
    expect(Math.abs(body.servertime - Date.now() / 1000), 'seconds off the local clock').toBeLessThan(300);
    expect(Math.abs(body.servertime - Number(res.headers()['x-api-servertime']))).toBeLessThanOrEqual(2);
  });
});

test.describe('GET /screensaver', { tag: '@no-session' }, () => {
  test('needs no session and counts its own slides', async ({ anonApi }) => {
    const body = await expectResponse<{ count: number; items: unknown[] }>(await anonApi.getScreensaver(), 'getScreensaver', 200);
    expect(body.count).toBe(body.items.length);
  });
});

test.describe('GET /speedtest', () => {
  test('lists the speed test servers', async ({ api }) => {
    const body = await expectResponse<{ count: number; items: unknown[] }>(await api.getSpeedtest(), 'getSpeedtest', 200);
    expect(body.count).toBe(body.items.length);
    expect(body.count).toBeGreaterThan(0);
  });
});
