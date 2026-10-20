import { test, expect } from '../fixtures';
import { expectKnownIssue, expectResponse } from '../../src/assertions';
import { apiPath } from '../../src/client';
import type { RadioStation } from '../../src/types';

// GET /radio is the deprecated station list (the radio page and its channel group
// replace it), still served for older clients. Its two operations are the only ones
// the spec gives no operationId, hence the `GET /radio` ids.
test.describe('GET /radio (deprecated)', () => {
  test('lists stations, each with a play link to its own GET /radio/{id}', { tag: '@RAD-01' }, async ({ api }) => {
    const body = await expectResponse<{ data: RadioStation[] }>(await api.getRadio(), 'GET /radio', 200);
    expect(body.data.length).toBeGreaterThan(0);
    expect(new Set(body.data.map((s) => s.id)).size, 'unique ids').toBe(body.data.length);
    for (const station of body.data) {
      expect(station._links.play).toMatchObject({ method: 'GET', path: `/api/v4/radio/${station.id}` });
    }
  });

  test('play links have no title (known API bug)', { tag: '@RAD-02' }, async ({ api }) => {
    await expectKnownIssue(await api.getRadio(), 'GET /radio', 200, 'radio-play-link-title');
  });

  test('some stations have a null description (known API bug)', { tag: '@RAD-03' }, async ({ api }) => {
    await expectKnownIssue(await api.getRadio(), 'GET /radio', 200, 'radio-null-description');
  });
});

test.describe('GET /radio/{id}', () => {
  test('the play link of a station answers with its stream URL', { tag: '@RAD-04' }, async ({ api }) => {
    const { data } = await expectResponse<{ data: RadioStation[] }>(await api.getRadio(), 'GET /radio', 200);
    const body = await expectResponse<{ url: string }>(
      await api.raw('GET', apiPath(data[0]._links.play.path!)),
      'GET /radio/{id}',
      200,
    );
    expect(body.url).toBeTruthy();
  });
});
