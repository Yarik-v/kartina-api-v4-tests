import { test, expect } from '../fixtures';
import { expectResponse, recordKnownIssue } from '../../src/assertions';
import { allOperations, documentedHeaders } from '../../src/spec';

test.describe('conditional requests', () => {
  test('responses that document an ETag come without one (known API bug)', { tag: ['@GEN-05', '@pinned'] }, async ({ api }) => {
    // 19 responses document `ETag` and a 304 for a matching `If-None-Match`, but the
    // server sends no ETag (staging and production), so clients can't revalidate.
    // Pinned on a few: once ETags show up this fails; then check the 304 round trip.
    const documenting = allOperations().filter((op) => documentedHeaders(op.id, 200).includes('ETag'));
    expect(documenting.length).toBeGreaterThan(0);
    for (const res of [await api.getChannels(), await api.getFavorites(), await api.getPlaybackBlock()]) {
      expect(res.status()).toBe(200);
      expect(res.headers()['etag'], res.url()).toBeUndefined();
    }
    recordKnownIssue(`etag-not-sent: no response carries the ETag that ${documenting.length} operations document, so 304 never happens`);
  });

  test('X-Clear-Cache is accepted and the answer is the same resource', { tag: '@GEN-06' }, async ({ api, channels }) => {
    const body = await expectResponse<{ count: number }>(
      await api.getChannels({ headers: { 'X-Clear-Cache': '1' } }),
      'getChannels',
      200,
    );
    expect(body.count).toBe(channels.count);
  });
});
