// Replays the requests behind every finding of the bug report on a session of its
// own and records each exchange exactly as sent and received. Changes nothing for
// good: the one write (a channel favorite, for D3) is taken back right away.
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

  const now = Math.floor(Date.now() / 1000);
  const loginCall = await call('POST', '/login', { json: { login, password, device, serial } });
  if (loginCall.exchange.status !== 200) throw new Error(`Login failed: ${loginCall.exchange.status} ${loginCall.exchange.body}`);
  ssid = loginCall.json.security;

  /** @type {Record<string, any>} */
  const out = { login: log.length };
  try {
    // Live data to pick titles and channels from (not part of the report).
    const dashboard = (await call('GET', '/pages/dashboard', { keep: false })).json;
    /** @type {any[]} */
    const cards = [];
    for (const block of dashboard.items) {
      const { json } = await call('GET', block.block_url.replace('/api/v4', ''), { keep: false });
      for (const item of json?.items ?? []) if (item.details_url && item.playable) cards.push(item);
    }
    /** @type {Map<string, any>} one title per service, a movie where there is one */
    const perService = new Map();
    for (const card of [...cards.filter((c) => c.kind === 'movie'), ...cards]) if (!perService.has(card.service)) perService.set(card.service, card);
    const channels = (await call('GET', '/channels', { keep: false })).json.items.filter(
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

    // A2: the teleteka of past programmes the EPG marks `teleteka: false`, up to 12 of
    // them (two per channel): since 21.10.2026 some answer the documented 403, some
    // still the stub.
    out.teleteka = { epg: null, programmes: [] };
    for (const channel of channels.slice(0, 40)) {
      const epg = await call('GET', `/channels/${channel.id}/epg?from=${now - 86400}&to=${now}`, { keep: false });
      const programmes = epg.json.items.filter(/** @param {any} p */ (p) => !p.teleteka && p.ends_at < now).slice(0, 2);
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
          stub: String(teleteka.json?.url ?? '').includes('/zaglushka/'),
          errorType: teleteka.json?.error?.type ?? null,
        });
      }
      if (out.teleteka.programmes.length >= 12) break;
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
    const wrongKind = group.json.items.filter(/** @param {any} i */ (i) => i.kind !== 'radio');
    out.radioGroupWrongKind = wrongKind.map(/** @param {any} i */ (i) => ({ id: i.id, title: i.title, kind: i.kind, play_url: i.play_url }));
    out.radioGroup = record(group.exchange, {
      body: JSON.stringify({ ...group.json, items: [...wrongKind, `… ещё ${group.json.items.length - wrongKind.length} станций с kind "radio"`] }, null, 1),
      note: 'тело сокращено до станций с неверным kind',
    });

    // A8: the first station and the ones with a null description.
    const radio = await call('GET', '/radio', { keep: false });
    const nullDescription = radio.json.data.filter(/** @param {any} s */ (s) => s.description === null);
    out.radioTotal = radio.json.data.length;
    out.radioNoTitle = radio.json.data.filter(/** @param {any} s */ (s) => !('title' in s._links.play)).length;
    out.radioNullDescription = nullDescription.map(/** @param {any} s */ (s) => ({ id: s.id, title: s.title }));
    out.radio = record(radio.exchange, {
      body: JSON.stringify({ data: [radio.json.data[0], '…', ...nullDescription, '…'] }, null, 1),
      note: `тело сокращено: первая станция и станции с description: null (всего ${radio.json.data.length})`,
    });

    // S1: errors and headers without a session, and the profiler link they advertise.
    out.debugAnon = (await call('GET', '/account', { anon: true })).exchange.n;
    const servertime = await call('GET', '/servertime', { anon: true });
    out.debugServertime = servertime.exchange.n;
    const profilerLink = servertime.exchange.resHeaders.find(([name]) => name === 'x-debug-token-link')?.[1];
    if (profilerLink) {
      const res = await fetch(profilerLink, { redirect: 'manual' });
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

    // D3: a fresh channel favorite doesn't show in the "favorite-channels" block. Taken back.
    const channel = [...channels].reverse().find(/** @param {any} c */ (c) => !c.favorite);
    if (channel) {
      out.d3channel = { id: channel.id, title: channel.title };
      out.d3 = [(await call('PUT', `/channels/${channel.id}/favorite`)).exchange.n];
      try {
        out.d3.push((await call('GET', '/favorites/channels')).exchange.n, (await call('GET', '/blocks/client-channels')).exchange.n);
      } finally {
        out.d3.push((await call('DELETE', `/channels/${channel.id}/favorite`)).exchange.n);
      }
    }
  } finally {
    // Whatever failed above, the session doesn't keep one of the account's few slots.
    out.logout = (await call('POST', '/logout')).exchange.n;
    out.after = (await call('GET', '/account')).exchange.n;
  }
  out.meta = { base, device, serial, login, ssid, at: log[0].at, until: log[log.length - 1].at };
  return { out, log };
}
