import { test, expect } from '../fixtures';
import { expectError, expectResponse, recordKnownIssue } from '../../src/assertions';
import { apiPath, type V4ApiClient } from '../../src/client';
import { v4ProtectCode } from '../../src/config';
import type { ChannelEpg, ChannelListCard, ChannelsList, Page, PlaybackStream } from '../../src/types';

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const NOT_A_CHANNEL = 999999999;

const playableChannel = (list: ChannelsList, extra: (c: ChannelListCard) => boolean = () => true) =>
  list.items.find((c) => c.playable && !c.access.protected && extra(c));

test.describe('GET /channels', () => {
  test('lists every channel once, with its own play, EPG and favorite links', { tag: '@CH-01' }, async ({ api }) => {
    const body = await expectResponse<ChannelsList>(await api.getChannels(), 'getChannels', 200);
    expect(body.count).toBe(body.items.length);
    expect(body.count).toBeGreaterThan(0);
    expect(new Set(body.items.map((c) => c.id)).size, 'unique ids').toBe(body.count);
    for (const channel of body.items) {
      expect(channel.play_url).toBe(`/api/v4/channels/${channel.id}/play`);
      expect(channel.epg_url).toBe(`/api/v4/channels/${channel.id}/epg`);
      if (channel.favorite_url) expect(channel.favorite_url).toBe(`/api/v4/channels/${channel.id}/favorite`);
    }
  });

  test('every group_id is a channel group of the TV page', { tag: '@CH-02' }, async ({ api, channels }) => {
    const tv = await expectResponse<Page>(await api.getTvPage(), 'getTvPage', 200);
    const groups = new Set(tv.items.map((block) => block.id));
    const orphans = channels.items.filter((c) => !groups.has(c.group_id));
    expect(orphans.map((c) => `${c.id} (group ${c.group_id})`), 'channels whose group is not on the TV page').toEqual([]);
  });

  test('hidden channels are not listed without show=1', { tag: '@CH-03' }, async ({ channels }) => {
    expect(channels.items.filter((c) => c.access.hidden).map((c) => c.id)).toEqual([]);
  });

  test('show=1 without the protect code answers 400 E_NEED_PARAM', { tag: '@CH-04' }, async ({ api }) => {
    const body = await expectError(await api.getChannels({ params: { show: 1 } }), 'getChannels', 400, 'E_NEED_PARAM');
    expect(body.error.details.description).toContain('protect');
  });
});

test.describe('GET /channels/{id}/epg', () => {
  test('returns the channel and its programmes in broadcast order, within the documented window', { tag: '@CH-05' }, async ({ api, channels }) => {
    const channel = playableChannel(channels)!;
    const body = await expectResponse<ChannelEpg>(await api.getChannelEpg(channel.id), 'getChannelEpg', 200);

    expect(body.channel.id).toBe(channel.id);
    expect(body.count).toBe(body.items.length);
    expect(body.count).toBeGreaterThan(0);
    for (const [i, programme] of body.items.entries()) {
      expect(programme.ends_at, `programme ${i} ends after it starts`).toBeGreaterThan(programme.starts_at);
      if (i > 0) expect(programme.starts_at, `programme ${i} in order`).toBeGreaterThanOrEqual(body.items[i - 1].starts_at);
    }
    // At most now − 14 days … now + 8 days, per the docs.
    expect(body.items[0].starts_at).toBeGreaterThanOrEqual(now() - 15 * DAY);
    expect(body.items.at(-1)!.starts_at).toBeLessThanOrEqual(now() + 8 * DAY);
  });

  test('from / to narrow the guide to that window', { tag: '@CH-06' }, async ({ api, channels }) => {
    const channel = playableChannel(channels)!;
    const from = now() - 6 * 60 * 60;
    const to = now();
    const body = await expectResponse<ChannelEpg>(await api.getChannelEpg(channel.id, { from, to }), 'getChannelEpg', 200);
    expect(body.count).toBeGreaterThan(0);
    for (const programme of body.items) {
      expect(programme.ends_at, 'ends after `from`').toBeGreaterThan(from);
      expect(programme.starts_at, 'starts before `to`').toBeLessThanOrEqual(to);
    }
  });

  test('a non-numeric id answers 404', { tag: '@CH-07' }, async ({ api }) => {
    await expectError(await api.getChannelEpg('playwright'), 'getChannelEpg', 404);
  });

  test('a channel outside the packet answers 403', { tag: '@CH-08' }, async ({ api }) => {
    await expectError(await api.getChannelEpg(NOT_A_CHANNEL), 'getChannelEpg', 403);
  });
});

test.describe('GET /channels/{id}/play', () => {
  test('a playable channel answers with a stream URL', { tag: '@CH-10' }, async ({ api, channels }) => {
    const channel = playableChannel(channels)!;
    const body = await expectResponse<PlaybackStream>(await api.playChannel(channel.id), 'playChannel', 200);
    expect(body.url).toBeTruthy();
  });

  test('a protected channel without the protect code answers 403 E_CURRENT_PASS_BAD', { tag: '@CH-11' }, async ({ api, channels }) => {
    const channel = channels.items.find((c) => c.access.protected);
    test.skip(!channel, 'No protected channel in the packet');
    await expectError(await api.playChannel(channel!.id), 'playChannel', 403, 'E_CURRENT_PASS_BAD');
  });

  test('a protected channel plays with the protect code', { tag: '@CH-12' }, async ({ api, channels }) => {
    test.skip(!v4ProtectCode, 'V4_PROTECT_CODE is not set in .env');
    const channel = channels.items.find((c) => c.access.protected && c.playable);
    test.skip(!channel, 'No playable protected channel in the packet');
    await expectResponse(await api.playChannel(channel!.id, { protect: v4ProtectCode }), 'playChannel', 200);
  });

  test('a channel outside the packet answers 403 E_NOT_ALLOWED', { tag: '@CH-13' }, async ({ api }) => {
    await expectError(await api.playChannel(NOT_A_CHANNEL), 'playChannel', 403, 'E_NOT_ALLOWED');
  });

  test('a non-numeric id answers 404', { tag: '@CH-14' }, async ({ api }) => {
    await expectError(await api.playChannel('playwright'), 'playChannel', 404);
  });
});

test.describe('archive and teleteka', () => {
  // A past programme's play_url points at the teleteka when there's a recording, at
  // the archive otherwise; the two endpoints never fall back to each other.
  test('every past programme links to its teleteka recording or its archive', { tag: '@CH-15' }, async ({ api, channels }) => {
    const channel = playableChannel(channels)!;
    const epg = await expectResponse<ChannelEpg>(await api.getChannelEpg(channel.id, { from: now() - DAY, to: now() }), 'getChannelEpg', 200);
    for (const programme of epg.items.filter((p) => p.ends_at < now())) {
      const kind = programme.teleteka ? 'teleteka' : 'archive';
      expect(programme.play_url).toBe(`/api/v4/channels/${channel.id}/${kind}/${programme.starts_at}`);
    }
  });

  test('GET .../archive/{timestamp} of a programme that ended hours ago answers with a stream', { tag: '@CH-16' }, async ({ api, channels }) => {
    const channel = playableChannel(channels, (c) => c.capabilities.archive);
    test.skip(!channel, 'No unprotected archive channel');
    const epg = await expectResponse<ChannelEpg>(
      await api.getChannelEpg(channel!.id, { from: now() - DAY, to: now() - 3 * 60 * 60 }),
      'getChannelEpg',
      200,
    );
    // Hours, not minutes, ago: a programme enters the archive only after `catchup.delay`.
    const programme = epg.items.find((p) => p.ends_at < now() - 3 * 60 * 60);
    test.skip(!programme, 'No programme in the archive window');
    await expectResponse<PlaybackStream>(await api.playChannelArchive(channel!.id, programme!.starts_at), 'playChannelArchive', 200);
  });

  test('archive of a channel without archive answers 400', { tag: '@CH-17' }, async ({ api, channels }) => {
    const channel = playableChannel(channels, (c) => !c.capabilities.archive);
    test.skip(!channel, 'Every unprotected channel has an archive');
    await expectError(await api.playChannelArchive(channel!.id, now() - 3 * 60 * 60), 'playChannelArchive', 400);
  });

  test('a teleteka recording plays through its play_url', { tag: '@CH-18' }, async ({ api, channels }) => {
    // Teleteka recordings are on some channels only; look through the first ones.
    for (const channel of channels.items.filter((c) => c.playable && !c.access.protected).slice(0, 10)) {
      const epg = await expectResponse<ChannelEpg>(
        await api.getChannelEpg(channel.id, { from: now() - DAY, to: now() }),
        'getChannelEpg',
        200,
      );
      const programme = epg.items.find((p) => p.teleteka && p.playable && p.ends_at < now());
      if (!programme) continue;
      await expectResponse(await api.raw('GET', apiPath(programme.play_url)), 'playChannelTeleteka', 200);
      return;
    }
    test.skip(true, 'No playable teleteka recording on the first channels');
  });

  test('teleteka of a programme without a recording still plays a stub for some programmes (known API bug, partly fixed)', { tag: ['@CH-19', '@pinned'] }, async ({
    api,
    channels,
  }) => {
    // Documented: 403 E_ARCHIVE_NOT_AVAILABLE ("nothing recorded this moment"). Until
    // the staging deploy of 21.10.2026 every such programme got 200 with a placeholder
    // clip (`.../zaglushka/...`); since then some answer the documented 403 and some
    // still the stub, even on the same channel. So this looks at up to 12 programmes
    // the EPG marks `teleteka: false`: a 403 must be the documented one, and the test
    // stays green while any of them still plays the stub. Once none does, it fails:
    // then assert the 403 for all of them instead.
    const outcomes: { channel: string; startsAt: number; stub: boolean }[] = [];
    for (const channel of channels.items.filter((c) => c.playable && !c.access.protected).slice(0, 40)) {
      const epg = await expectResponse<ChannelEpg>(
        await api.getChannelEpg(channel.id, { from: now() - DAY, to: now() }),
        'getChannelEpg',
        200,
      );
      for (const programme of epg.items.filter((p) => !p.teleteka && p.ends_at < now()).slice(0, 2)) {
        const res = await api.playChannelTeleteka(channel.id, programme.starts_at);
        if (res.status() === 403) {
          await expectError(res, 'playChannelTeleteka', 403, 'E_ARCHIVE_NOT_AVAILABLE');
          outcomes.push({ channel: channel.title, startsAt: programme.starts_at, stub: false });
        } else {
          const body = await expectResponse<PlaybackStream>(res, 'playChannelTeleteka', 200);
          expect(body.url, `a 200 for ${channel.title} ${programme.starts_at} is the stub`).toContain('/zaglushka/');
          outcomes.push({ channel: channel.title, startsAt: programme.starts_at, stub: true });
        }
      }
      if (outcomes.length >= 12) break;
    }
    test.skip(outcomes.length === 0, 'No past programme without a recording on the first channels');

    const stubs = outcomes.filter((o) => o.stub);
    expect(stubs.length, `the stub is gone for all ${outcomes.length} programmes: the bug is fixed`).toBeGreaterThan(0);
    recordKnownIssue(
      `teleteka-stub: ${stubs.length} of ${outcomes.length} programmes without a recording still get a 200 stub clip instead of 403 E_ARCHIVE_NOT_AVAILABLE (${[...new Set(stubs.map((o) => o.channel))].join(', ')})`,
    );
  });

  test('a timestamp no programme starts at answers 404 E_WRONG_ID', { tag: '@CH-20' }, async ({ api, channels }) => {
    const channel = playableChannel(channels)!;
    const body = await expectError(await api.playChannelTeleteka(channel.id, 1), 'playChannelTeleteka', 404, 'E_WRONG_ID');
    expect(body.error.details.description).toBe('Program not found');
  });
});

// Hiding needs the protect code, and DELETE /channels/hidden clears every rule the
// account has. So every test here, the negative ones included, runs only with the
// protect code and only while the account hides nothing: should the server wrongly
// accept a request without the code, nothing of the account's is lost, and `undo`
// unhides whatever a test may have hidden, also when it fails or times out.
test.describe('hidden channels', { tag: '@mutates' }, () => {
  async function skipUnlessNothingHidden(api: V4ApiClient): Promise<void> {
    test.skip(!v4ProtectCode, "V4_PROTECT_CODE is not set in .env: the account's hidden channels can't be checked first");
    const all = await expectResponse<ChannelsList>(
      await api.getChannels({ params: { show: 1, protect: v4ProtectCode } }),
      'getChannels',
      200,
    );
    test.skip(all.items.some((c) => c.access.hidden), 'The account hides channels of its own; not touching them');
  }

  const unhide = async (api: V4ApiClient, id: string) => {
    expect((await api.unhideChannel(id, { code: v4ProtectCode })).status(), `unhide channel ${id}`).toBe(204);
  };

  test('PUT /channels/{id}/hidden without the protect code answers 400', { tag: '@CH-22' }, async ({ api, channels, undo }) => {
    await skipUnlessNothingHidden(api);
    const channel = playableChannel(channels);
    test.skip(!channel, 'No playable unprotected channel in the packet');
    undo(() => unhide(api, channel!.id));
    await expectError(await api.hideChannel(channel!.id, {}), 'hideChannel', 400);
  });

  test('DELETE /channels/hidden without the protect code answers 400', { tag: '@CH-23' }, async ({ api }) => {
    await skipUnlessNothingHidden(api);
    await expectError(await api.clearHiddenChannels({}), 'clearHiddenChannels', 400);
  });

  test('hide, list with show=1, unhide and reset', { tag: '@CH-24' }, async ({ api, channels, undo }) => {
    await skipUnlessNothingHidden(api);
    const channel = playableChannel(channels);
    test.skip(!channel, 'No playable unprotected channel in the packet');
    const { id } = channel!;
    const code = { code: v4ProtectCode };
    undo(() => unhide(api, id));

    await expectResponse(await api.hideChannel(id, code), 'hideChannel', 204);
    await expectResponse(await api.hideChannel(id, code), 'hideChannel', 204);

    const visible = await expectResponse<ChannelsList>(await api.getChannels(), 'getChannels', 200);
    expect(visible.items.map((c) => c.id), 'gone from the plain list').not.toContain(id);
    const all = await expectResponse<ChannelsList>(
      await api.getChannels({ params: { show: 1, protect: v4ProtectCode } }),
      'getChannels',
      200,
    );
    expect(all.items.find((c) => c.id === id)?.access.hidden, 'listed as hidden with show=1').toBe(true);

    await expectResponse(await api.unhideChannel(id, code), 'unhideChannel', 204);
    const again = await expectResponse<ChannelsList>(await api.getChannels(), 'getChannels', 200);
    expect(again.items.map((c) => c.id), 'back in the plain list').toContain(id);

    await expectResponse(await api.hideChannel(id, code), 'hideChannel', 204);
    await expectResponse(await api.clearHiddenChannels(code), 'clearHiddenChannels', 204);
    const reset = await expectResponse<ChannelsList>(await api.getChannels(), 'getChannels', 200);
    expect(reset.items.map((c) => c.id), 'back after the reset').toContain(id);
  });
});
