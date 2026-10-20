import { test, expect } from '../fixtures';
import { expectResponse, recordKnownIssue } from '../../src/assertions';
import { allOperations, documentedHeaders } from '../../src/spec';

test.describe('conditional requests', () => {
  test('responses that document an ETag come without one (known API bug)', async ({ api }) => {
    // 19 responses document `ETag`, and `304 Not Modified` for a matching
    // `If-None-Match`, but the server sends no ETag at all (staging and production),
    // so a client can never revalidate. Pinned on a few of them: once ETags show up
    // this fails; then check the 304 round trip instead.
    const documenting = allOperations().filter((op) => documentedHeaders(op.id, 200).includes('ETag'));
    expect(documenting.length).toBeGreaterThan(0);
    for (const res of [await api.getChannels(), await api.getFavorites(), await api.getPlaybackBlock()]) {
      expect(res.status()).toBe(200);
      expect(res.headers()['etag'], res.url()).toBeUndefined();
    }
    recordKnownIssue(`etag-not-sent: no response carries the ETag that ${documenting.length} operations document, so 304 never happens`);
  });

  test('X-Clear-Cache is accepted and the answer is the same resource', async ({ api, channels }) => {
    const body = await expectResponse<{ count: number }>(
      await api.getChannels({ headers: { 'X-Clear-Cache': '1' } }),
      'getChannels',
      200,
    );
    expect(body.count).toBe(channels.count);
  });
});
