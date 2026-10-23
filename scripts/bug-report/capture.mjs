// Replays the requests behind every bug-report finding on its own session and logs
// each exchange as sent and received. Its one write (a channel favorite, for D3) is
// undone right away.
import { TELETEKA_EPG_SPAN, TELETEKA_SAMPLE, isTeletekaStub, programmesWithoutRecording, teletekaChannels } from '../../src/teleteka.mjs';
import { streamFile } from './util.mjs';

/**
 * @typedef {object} Exchange
 * @property {number} n           1-based number, as the report shows it
 * @property {string} at          ISO time the request was sent
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} reqHeaders
 * @property {string | null} reqBody
 * @property {number} status
 * @property {[string, string][]} resHeaders
 * @property {string} body        response body, or a shortened one (then `note` says so)
 * @property {string} [note]
 */

/**
 * @typedef {object} CaptureOptions
 * @property {string} base     e.g. https://rustvt.kartina.tv/api/v4
 * @property {string} login
 * @property {string} password
 * @property {string} device
 * @property {string} serial   its own serial, so the session is easy to find in the logs
 */

/** @param {Headers} headers @returns {[string, string][]} */
const headerList = (headers) => {
  /** @type {[string, string][]} */
  const list = [];
  headers.forEach((value, name) => list.push([name, value]));
  return list;
};


/** @param {CaptureOptions} options */
export async function capture({ base, login, password, device, serial }) {
  /** @type {Exchange[]} */
  const log = [];
  /** @type {string | null} */
  let ssid = null;

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ anon?: boolean, headers?: Record<string, string>, json?: unknown, keep?: boolean }} [options]
   */
  async function call(method, path, { anon = false, headers = {}, json, keep = true } = {}) {
    /** @type {Record<string, string>} */
    const reqHeaders = { Accept: 'application/json', ...headers };
    if (!anon && ssid) reqHeaders.Cookie = `MW_SSID=${ssid}`;
    if (json !== undefined) reqHeaders['Content-Type'] = 'application/json';
    const reqBody = json === undefined ? null : JSON.stringify(json);
    const at = new Date().toISOString();
    const res = await fetch(base + path, { method, redirect: 'manual', headers: reqHeaders, body: reqBody ?? undefined });
    const body = await res.text();
    /** @type {any} */
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {}
    /** @type {Exchange} */
    const exchange = { n: 0, at, method, url: base + path, reqHeaders, reqBody, status: res.status, resHeaders: headerList(res.headers), body };
    if (keep) exchange.n = record(exchange);
    return { exchange, json: parsed };
  }

  /**
   * Adds an exchange to the log (optionally with a shortened body) and returns its number.
   * @param {Exchange} exchange
   * @param {{ body?: string, note?: string }} [shortened]
   */
  function record(exchange, shortened = {}) {
    const entry = { ...exchange, ...shortened, n: log.length + 1 };
    log.push(entry);
    return entry.n;
  }

  /**
   * Whether a step got JSON. A gateway 503 page or an error envelope makes the step
   * skip (or `required` stop with a clear message) instead of crashing the report.
   * @param {{ exchange: Exchange, json: any }} result
   */
  const ok = (result) => result.exchange.status === 200 && result.json !== null && typeof result.json === 'object';
  /**
   * @param {{ exchange: Exchange, json: any }} result
   * @param {string} what
   */
  const required = (result, what) => {
    if (!ok(result)) throw new Error(`capture: ${what} answered ${result.exchange.status}: ${result.exchange.body.slice(0, 200)}`);
    return result.json;
  };

  const now = Math.floor(Date.now() / 1000);
  const loginCall = await call('POST', '/login', { json: { login, password, device, serial } });
  if (loginCall.exchange.status !== 200) throw new Error(`Login failed: ${loginCall.exchange.status} ${loginCall.exchange.body}`);
  ssid = loginCall.json.security;

  /** @type {Record<string, any>} */
  const out = { login: log.length };
  try {
    // Live data to pick titles and channels from (not part of the report).
    const dashboard = required(await call('GET', '/pages/dashboard', { keep: false }), 'GET /pages/dashboard');
    /** @type {any[]} */
    const cards = [];
    for (const block of dashboard.items) {
      const { json } = await call('GET', block.block_url.replace('/api/v4', ''), { keep: false });
      for (const item of json?.items ?? []) if (item.details_url && item.playable) cards.push(item);
    }
    /** @type {Map<string, any>} one title per service, a movie where there is one */
    const perService = new Map();
    for (const card of [...cards.filter((c) => c.kind === 'movie'), ...cards]) if (!perService.has(card.service)) perService.set(card.service, card);
    /** @type {any[]} */
    const channels = required(await call('GET', '/channels', { keep: false }), 'GET /channels').items.filter(
      /** @param {any} c */ (c) => c.playable && !c.access.protected,
    );

    // A1: a made-up trailer id next to the title's own stream (ivi doesn't play here by design).
    out.trailer = [];
    for (const card of perService.values()) {
      if (card.service === 'iviru') continue;
      const trailer = await call('GET', `/content/${card.service}/${card.id}/trailers/playwright-no-such-trailer/play`);
      const play = await call('GET', `/content/${card.service}/${card.id}/play`);
      out.trailer.push({
        service: card.service,
        kind: card.kind,
        title: card.title,
        trailer: trailer.exchange.n,
        play: play.exchange.n,
        trailerStatus: trailer.exchange.status,
        trailerUrl: trailer.json?.url ?? null,
        trailerError: trailer.json?.error ?? null,
        sameFile: Boolean(trailer.json?.url && play.json?.url && streamFile(trailer.json.url) === streamFile(play.json.url)),
      });
    }

    // A2: teleteka of past programmes without a recording, same sample as CH-19. Since
    // 21.10.2026 some get the documented 403, some still the stub.
    out.teleteka = { epg: null, programmes: [] };
    for (const channel of teletekaChannels(channels)) {
      const epg = await call('GET', `/channels/${channel.id}/epg?from=${now - TELETEKA_EPG_SPAN}&to=${now}`, { keep: false });
      if (!ok(epg) || !Array.isArray(epg.json.items)) continue;
      const programmes = programmesWithoutRecording(/** @type {any[]} */ (epg.json.items), now);
      if (!programmes.length) continue;
      if (out.teleteka.epg === null) {
        out.teleteka.epg = record(epg.exchange, {
          body: JSON.stringify({ channel: { id: epg.json.channel.id, title: epg.json.channel.title }, count: epg.json.count, items: ['…', ...programmes, '…'] }, null, 1),
          note: 'тело сокращено до программ, о которых речь',
        });
      }
      for (const programme of programmes) {
        const teleteka = await call('GET', `/channels/${channel.id}/teleteka/${programme.starts_at}`);
        out.teleteka.programmes.push({
          channel: channel.id,
          channelTitle: channel.title,
          title: programme.title,
          startsAt: programme.starts_at,
          call: teleteka.exchange.n,
          status: teleteka.exchange.status,
          stub: isTeletekaStub(teleteka.json?.url),
          errorType: teleteka.json?.error?.type ?? null,
        });
      }
      if (out.teleteka.programmes.length >= TELETEKA_SAMPLE.total) break;
    }

    // A3, A4
    out.countries = (await call('GET', '/search/services/countries')).exchange.n;
    out.unknownBlock = (await call('GET', '/pages/dashboard/blocks/playwright-no-such-block')).exchange.n;
    out.blockLink = (await call('GET', '/pages/dashboard/blocks/playwright-no-such-block/fetch')).exchange.n;

    // A5: only the headers matter.
    out.etag = [];
    for (const path of ['/channels', '/favorites', '/blocks/playback']) {
      const { exchange } = await call('GET', path, { keep: false });
      out.etag.push(record(exchange, { body: `(тело ${exchange.body.length} байт опущено: смотрим только заголовки)` }));
    }
    const conditional = await call('GET', '/channels', { headers: { 'If-None-Match': '"anything"' }, keep: false });
    out.etagInm = record(conditional.exchange, { body: `(тело ${conditional.exchange.body.length} байт опущено)` });

    // A6
    out.playbackLimit = [];
    for (const limit of [0, 101, -5]) out.playbackLimit.push((await call('GET', `/blocks/playback?limit=${limit}`)).exchange.n);
    out.searchLimit = (await call('GET', '/search/services?limit=0')).exchange.n;

    // A7: the radio group, shortened to the stations with the wrong kind.
    const group = await call('GET', '/pages/radio/channel-group', { keep: false });
    if (ok(group) && Array.isArray(group.json.items)) {
      const wrongKind = group.json.items.filter(/** @param {any} i */ (i) => i.kind !== 'radio');
      out.radioGroupWrongKind = wrongKind.map(/** @param {any} i */ (i) => ({ id: i.id, title: i.title, kind: i.kind, play_url: i.play_url }));
      out.radioGroup = record(group.exchange, {
        body: JSON.stringify({ ...group.json, items: [...wrongKind, `… ещё ${group.json.items.length - wrongKind.length} станций с kind "radio"`] }, null, 1),
        note: 'тело сокращено до станций с неверным kind',
      });
    } else {
      out.radioGroupWrongKind = null;
      out.radioGroup = record(group.exchange);
    }

    // A8: the first station and the ones with a null description.
    const radio = await call('GET', '/radio', { keep: false });
    if (ok(radio) && Array.isArray(radio.json.data)) {
      const nullDescription = radio.json.data.filter(/** @param {any} s */ (s) => s.description === null);
      out.radioTotal = radio.json.data.length;
      out.radioNoTitle = radio.json.data.filter(/** @param {any} s */ (s) => !('title' in (s._links?.play ?? {}))).length;
      out.radioNullDescription = nullDescription.map(/** @param {any} s */ (s) => ({ id: s.id, title: s.title }));
      out.radio = record(radio.exchange, {
        body: JSON.stringify({ data: [radio.json.data[0], '…', ...nullDescription, '…'] }, null, 1),
        note: `тело сокращено: первая станция и станции с description: null (всего ${radio.json.data.length})`,
      });
    } else {
      out.radioNullDescription = null;
      out.radio = record(radio.exchange);
    }

    // S1: errors and headers without a session, and the profiler link they advertise.
    out.debugAnon = (await call('GET', '/account', { anon: true })).exchange.n;
    const servertime = await call('GET', '/servertime', { anon: true });
    out.debugServertime = servertime.exchange.n;
    const profilerLink = servertime.exchange.resHeaders.find(([name]) => name === 'x-debug-token-link')?.[1];
    if (profilerLink) {
      // Optional evidence: an unreachable profiler host only leaves the exchange out.
      try {
        const res = await fetch(profilerLink, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        out.profiler = record({
          n: 0,
          at: new Date().toISOString(),
          method: 'GET',
          url: profilerLink,
          reqHeaders: {},
          reqBody: null,
          status: res.status,
          resHeaders: headerList(res.headers),
          body: (await res.text()).slice(0, 400),
        });
      } catch {}
    }

    // D2: details of a startru title, and favorites by that service.
    const startru = perService.get('startru');
    if (startru) {
      const details = await call('GET', `/content/startru/${startru.id}`, { keep: false });
      out.d2details = record(details.exchange, {
        body: JSON.stringify({ id: details.json?.id, service: details.json?.service, kind: details.json?.kind, title: details.json?.title, '…': '…' }, null, 1),
        note: 'тело сокращено',
      });
      out.d2fav = (await call('GET', '/favorites/startru')).exchange.n;
    }

    // D3: a fresh channel favorite doesn't show in the "favorite-channels" block. The
    // channel is checked not to be a favorite, so the favorite is removed afterwards
    // unless the PUT answered 200 (the subscriber's own); also when the PUT threw, as
    // the server may have added it anyway.
    const liveFavorites = await call('GET', '/favorites/channels', { keep: false });
    const listed = ok(liveFavorites) && Array.isArray(liveFavorites.json.items);
    const favoriteIds = new Set(listed ? liveFavorites.json.items.map(/** @param {any} c */ (c) => c.id) : []);
    const channel = listed ? [...channels].reverse().find(/** @param {any} c */ (c) => !c.favorite && !favoriteIds.has(c.id)) : undefined;
    if (channel) {
      out.d3channel = { id: channel.id, title: channel.title };
      out.d3 = [];
      let created = false;
      let subscribersOwn = false;
      try {
        const put = await call('PUT', `/channels/${channel.id}/favorite`);
        out.d3.push(put.exchange.n);
        created = put.exchange.status === 201;
        subscribersOwn = put.exchange.status === 200;
        out.d3.push((await call('GET', '/favorites/channels')).exchange.n, (await call('GET', '/blocks/client-channels')).exchange.n);
      } finally {
        if (!subscribersOwn) out.d3.push((await call('DELETE', `/channels/${channel.id}/favorite`)).exchange.n);
      }
      if (!created) out.d3 = undefined;
    }
  } finally {
    // Always free the session slot. The report shows the session id, so it must be
    // confirmed dead: logout (retried once), then GET /account must refuse it. A throw
    // here leaves `sessionClosed` false (no report is written) with the reason in
    // `logoutError`, without hiding the error that stopped the capture.
    out.sessionClosed = false;
    try {
      let logout = await call('POST', '/logout');
      if (logout.exchange.status !== 204) logout = await call('POST', '/logout');
      out.logout = logout.exchange.n;
      const after = await call('GET', '/account');
      out.after = after.exchange.n;
      out.sessionClosed = after.exchange.status === 403 && after.json?.error?.type === 'E_AUTH_ERROR';
    } catch (error) {
      out.logoutError = error instanceof Error ? error.message : String(error);
    }
  }
  out.meta = { base, device, serial, login, ssid, at: log[0].at, until: log[log.length - 1].at };
  return { out, log };
}
