// Renders the developer bug report: the findings (written by hand below), every
// exchange behind them exactly as sent and received, and the per-case results of the
// test run. When a pinned test turns red (the bug looks fixed), its finding shows
// "не воспроизвелось" in the summary; update or drop the finding here then.
import { readFileSync } from 'node:fs';
import { esc, md, streamFile } from './util.mjs';

/**
 * @typedef {import('./capture.mjs').Exchange} Exchange
 * @typedef {ReturnType<typeof import('./cases.mjs').caseResults>} Cases
 * @typedef {import('./cases.mjs').CaseStatus} CaseStatus
 * @typedef {number | [number, { open?: boolean, label?: string }]} ExchangeRef
 * @typedef {{ id: string, sev: 'high' | 'mid' | 'low' | 'doc', area: string, short: string, title: string, cases: string[], body: string, exchanges: ExchangeRef[] }} Finding
 */

const CSS = readFileSync(new URL('./report.css', import.meta.url), 'utf8');
/** The password never makes it into the report; everything else is shown as sent. */
const PASSWORD_PLACEHOLDER = '<пароль: не включён в отчёт>';
const SEV_NAME = { high: 'высокая', mid: 'средняя', low: 'низкая', doc: 'документация' };
/** @type {Record<CaseStatus, [string, string]>} */
const STATUS = {
  pass: ['ok', 'пройден'],
  'pass-known': ['okk', 'пройден*'],
  bug: ['bugrep', 'баг воспроизводится'],
  skip: ['skip', 'пропущен'],
  notrun: ['notrun', 'не запускался'],
  gap: ['gap', 'не автоматизирован'],
  fail: ['fail', 'упал'],
};

/** @param {string} s */
const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
/** @param {string} body */
const pretty = (body) => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};
/** @param {string} iso */
const utc = (iso) => iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1 UTC');

/**
 * @param {{ capture: { out: Record<string, any>, log: Exchange[] }, cases: Cases, hostLabel: string }} input
 * @returns {string}
 */
export function render({ capture, cases, hostLabel }) {
  const { out } = capture;
  const log = capture.log.map((e) => {
    if (!e.reqBody || !e.url.endsWith('/login')) return e;
    const body = JSON.parse(e.reqBody);
    return 'password' in body ? { ...e, reqBody: JSON.stringify({ ...body, password: PASSWORD_PLACEHOLDER }) } : e;
  });
  const base = out.meta.base;
  /** @param {number} n */
  const ex = (n) => log[n - 1];
  /** @param {number} n @returns {any} */
  const bodyOf = (n) => {
    try {
      return JSON.parse(ex(n).body);
    } catch {
      return null;
    }
  };
  /** @param {number} n */
  const rid = (n) => bodyOf(n)?.error?.request_id ?? '—';
  /** First frame of the staging trace outside vendor/, as `file:line`. @param {number} n */
  const ownFrame = (n) => {
    const frame = (bodyOf(n)?.exception?.trace ?? []).find(/** @param {any} f */ (f) => f.file && !f.file.includes('/vendor/'));
    return frame ? `${frame.file.replace(/^.*\/releases\/\d+\//, '')}:${frame.line}` : null;
  };

  /** @param {Exchange} e */
  const curl = (e) => {
    const parts = [`curl -i -X ${e.method} ${sq(e.url)}`];
    for (const [name, value] of Object.entries(e.reqHeaders)) parts.push(`-H ${sq(`${name}: ${value}`)}`);
    if (e.reqBody) parts.push(`--data-raw ${sq(e.reqBody)}`);
    return parts.join(' \\\n  ');
  };
  /** @param {ExchangeRef} ref */
  const exchange = (ref) => {
    const [n, { open = false, label = '' } = {}] = typeof ref === 'number' ? [ref] : ref;
    const e = ex(n);
    const head = `HTTP ${e.status}\n${e.resHeaders.map(([name, value]) => `${name}: ${value}`).join('\n')}`;
    const path = e.url.startsWith(base) ? e.url.slice(base.length) : e.url;
    return `<details class="ex"${open ? ' open' : ''}>
  <summary><span class="n">№${e.n}</span> <code>${esc(e.method)} ${esc(path)}</code> → <b class="st s${String(e.status)[0]}">${e.status}</b>${label ? ` <span class="lbl">${esc(label)}</span>` : ''}</summary>
  <div class="exbody">
    <div class="cap">Запрос · ${esc(utc(e.at))}</div>
    <pre><code>${esc(curl(e))}</code></pre>
    <div class="cap">Ответ${e.note ? ` · ${esc(e.note)}` : ''}</div>
    <pre><code>${esc(head)}\n\n${esc(pretty(e.body))}</code></pre>
  </div>
</details>`;
  };
  /** @param {ExchangeRef[]} refs */
  const exchanges = (refs) => `<div class="exs">${refs.map(exchange).join('\n')}</div>`;

  /** @type {any[]} */
  const trailers = out.trailer;
  const trailerRows = trailers
    .map((r) => {
      const what =
        r.trailerStatus === 200
          ? r.sameFile
            ? `<b>тот же файл, что <code>…/play</code></b> (№${r.play}): <code>${esc(streamFile(r.trailerUrl))}</code>`
            : `поток <code>${esc(streamFile(r.trailerUrl))}</code>; <code>…/play</code> (№${r.play}) отдаёт другой URL — по имени это сам фильм, не трейлер`
          : `<code>${esc(r.trailerError?.type)}</code>, request_id <code>${esc(r.trailerError?.request_id)}</code>${r.trailerStatus === 404 ? ' — как в документации' : ''}`;
      return `<tr><td>${esc(r.service)}</td><td>${esc(r.title)} (${esc(r.kind)})</td><td>№${r.trailer}</td><td>${r.trailerStatus}</td><td>${what}</td></tr>`;
    })
    .join('\n');
  const countriesCause = bodyOf(out.countries)?.exception;
  const blockCause = bodyOf(out.unknownBlock)?.exception?.message ?? '';
  const internalHost = blockCause.match(/https?:\/\/[^/\s"]+/)?.[0];
  const anonTrace = ownFrame(out.debugAnon);
  /** Whether this host's error bodies carry the debug trace (S1). */
  const stagingTrace = Boolean(bodyOf(out.debugAnon)?.exception);
  const tele = out.teleteka;
  /** @type {{ channel: string, channelTitle: string, title: string, startsAt: number, call: number, status: number, stub: boolean, errorType: string | null }[]} */
  const teleProgrammes = tele.programmes;
  const teleStubs = teleProgrammes.filter((p) => p.stub);
  /** The documented answer; every other non-stub outcome is counted apart, with its status. */
  const teleDocumented = teleProgrammes.filter((p) => !p.stub && p.status === 403 && p.errorType === 'E_ARCHIVE_NOT_AVAILABLE');
  const teleOther = teleProgrammes.filter((p) => !p.stub && !teleDocumented.includes(p));
  /** Channels where some programmes get the stub and others the documented 403. */
  const teleMixed = [...new Set(teleProgrammes.map((p) => p.channelTitle))].filter(
    (title) => teleStubs.some((p) => p.channelTitle === title) && teleDocumented.some((p) => p.channelTitle === title),
  );
  /** `null` when the request itself failed during the capture. @type {{ id: string, title: string, kind: string, play_url: string }[] | null} */
  const wrongKind = out.radioGroupWrongKind;
  /** @type {{ id: number, title: string }[] | null} */
  const nullDescription = out.radioNullDescription;
  const station = (/** @type {{ id: string | number, title: string }} */ s) => `<code>${esc(s.id)} «${esc(s.title)}»</code>`;

  /** @type {Finding[]} */
  const findings = [
    {
      id: 'A1', sev: 'high', cases: ['CNT-11'],
      area: '<code>GET /content/{service}/{id}/trailers/{trailerId}/play</code>',
      short: 'Несуществующий <code>trailerId</code> отдаёт поток самого тайтла вместо 404',
      title: 'Несуществующий trailerId отдаёт поток самого тайтла',
      body: `<dt>Эндпоинт</dt><dd><code>GET /content/{service}/{id}/trailers/{trailerId}/play</code></dd>
    <dt>По документации</dt><dd>Неизвестный трейлер: <code>404 E_WRONG_ID</code> («No such content, episode or trailer»). <code>503</code> описан только как <code>E_SERVICE_NOT_AVAILABLE</code> (сервис не настроен на инсталляции).</dd>
    <dt>Фактически</dt><dd><code>trailerId</code> игнорируется. По одному тайтлу на сервис, <code>trailerId = playwright-no-such-trailer</code>:
      <div class="table-wrap"><table><thead><tr><th>Сервис</th><th>Тайтл</th><th>Запрос</th><th>Ответ</th><th>Что отдаётся</th></tr></thead><tbody>${trailerRows}</tbody></table></div></dd>
    <dt>Почему важно</dt><dd>Эндпоинт трейлера отдаёт полный контент по любому <code>trailerId</code>. Если он проверяет доступ слабее, чем <code>…/play</code> (подписка, гео, «трейлеры доступны всем»), это обход платного доступа. У аккаунта всё оплачено, поэтому <b>это не проверено</b> — нужно посмотреть на стороне бэкенда. <code>503 E_SYSTEM_ERROR</code> у остальных сервисов заставляет клиента повторять запрос, хотя ресурса просто нет.</dd>
    <dt>Автотест</dt><dd><code>catalog/content.spec.ts</code> › «an unknown trailer id is not answered with the documented 404 (known API bug)»</dd>`,
      exchanges: trailers.flatMap((r) => [
        /** @type {ExchangeRef} */ ([r.trailer, { open: r.sameFile, label: `${r.service}: подставной трейлер` }]),
        /** @type {ExchangeRef} */ ([r.play, { label: `${r.service}: /play для сравнения` }]),
      ]),
    },
    {
      id: 'S1', sev: 'mid', cases: ['GEN-07'],
      area: 'все ошибки staging',
      short: 'Стектрейс Symfony, пути на сервере и внутренние хосты в теле ошибок',
      title: 'Staging отдаёт отладочный стектрейс в каждой ошибке',
      body: `<dt>Где</dt><dd>Любой ответ с ошибкой на <code>rustvt.kartina.tv</code> — смотрите поле <code>exception</code> в ответах этого отчёта. Production <code>iptv.kartina.tv</code> этого не делает.</dd>
    <dt>По документации</dt><dd>Тело ошибки — только <code>{"error": {…}}</code> (<code>additionalProperties: false</code>).</dd>
    <dt>Фактически</dt><dd>${stagingTrace ? '' : `<b>На ${esc(new URL(base).host)} в этом прогоне не воспроизводится:</b> тело ошибки (№${out.debugAnon}) без <code>exception</code>. Описание ниже — по staging. `}Рядом с <code>error</code> приходит <code>exception</code>: класс, сообщение, трейс с путями на сервере${anonTrace ? ` (<code>${esc(anonTrace)}</code>, №${out.debugAnon})` : ''}${internalHost ? `, внутренние хосты (<code>${esc(internalHost)}</code>, №${out.unknownBlock})` : ''}, причины падений (№${out.countries}). Каждый ответ несёт <code>X-Debug-Token</code>, <code>X-Debug-Token-Link</code>, <code>X-Powered-By</code> (№${out.debugServertime}).${out.profiler ? ` Ссылка на профайлер отвечает ${ex(out.profiler).status} (№${out.profiler}).` : ''}</dd>
    <dt>Почему важно</dt><dd>Staging доступен из интернета: структура кода, версии и внутренние адреса видны любому. Либо закрыть staging по IP, либо выключить <code>APP_DEBUG</code> и убрать заголовки.</dd>
    <dt>Автотест</dt><dd><code>other/errors.spec.ts</code> › «error bodies carry no debug trace, except on staging (known API bug)»</dd>`,
      exchanges: [[out.debugAnon, { open: true, label: 'без сессии' }], [out.debugServertime, { label: 'заголовки X-Debug-*' }], ...(out.profiler ? [/** @type {ExchangeRef} */ ([out.profiler, { label: 'ссылка на профайлер' }])] : [])],
    },
    {
      id: 'A2', sev: 'mid', cases: ['CH-19'],
      area: '<code>GET /channels/{id}/teleteka/{timestamp}</code>',
      short: 'Программа без записи: ролик-заглушка (200) вместо 403 — исправлено частично',
      title: 'Телетека программы без записи отдаёт ролик-заглушку (исправлено частично)',
      body: `<dt>Эндпоинт</dt><dd><code>GET /channels/{id}/teleteka/{timestamp}</code></dd>
    <dt>По документации</dt><dd>Нет записи: <code>403 E_ARCHIVE_NOT_AVAILABLE</code> («nothing recorded this moment»). Заглушка с извинением описана только для провайдера в режиме сбоя.</dd>
    <dt>Фактически</dt><dd>До деплоя staging 21.10.2026 любая прошедшая программа, которую EPG помечает <code>teleteka: false</code>, получала 200 с роликом-заглушкой (<code>…/zaglushka/index.m3u8</code>). После деплоя поведение разное${teleProgrammes.length ? `: из ${teleProgrammes.length} проверенных программ ${teleStubs.length} по-прежнему получают заглушку, ${teleDocumented.length} — документированный <code>403 E_ARCHIVE_NOT_AVAILABLE</code>${teleOther.length ? `, ${teleOther.length} — другой ответ (${teleOther.map((p) => `${p.status}${p.errorType ? ` ${esc(p.errorType)}` : ''}`).join(', ')})` : ''}${teleMixed.length ? `; на ${teleMixed.map((c) => `«${esc(c)}»`).join(', ')} — и то и другое в пределах одного канала` : ''}. Программы взяты из EPG (пример — №${tele.epg})` : ''}:
      ${teleProgrammes.length ? `<div class="table-wrap"><table><thead><tr><th>Канал</th><th>Программа</th><th><code>starts_at</code></th><th>Запрос</th><th>Ответ</th></tr></thead><tbody>${teleProgrammes.map((p) => `<tr><td>${esc(p.channel)} «${esc(p.channelTitle)}»</td><td>${esc(p.title)}</td><td>${p.startsAt}</td><td>№${p.call}</td><td>${p.stub ? '<b>200, заглушка</b>' : `${p.status} <code>${esc(p.errorType ?? '')}</code>`}</td></tr>`).join('')}</tbody></table></div>` : 'В EPG первых каналов не нашлось прошедшей программы без записи.'}</dd>
    <dt>Почему важно</dt><dd>Клиент не может отличить «записи нет» от реального потока и проигрывает заглушку вместо понятного сообщения; теперь ещё и по-разному для разных программ.</dd>
    <dt>Автотест</dt><dd><code>catalog/channels.spec.ts</code> › «teleteka of a programme without a recording still plays a stub for some programmes (known API bug, partly fixed)»: зелёный, пока заглушку получает хоть одна программа; упадёт, когда исправят полностью.</dd>`,
      exchanges: [
        ...(tele.epg ? [tele.epg] : []),
        ...teleProgrammes.map((p, i) => /** @type {ExchangeRef} */ ([p.call, { open: i === teleProgrammes.findIndex((q) => q.stub), label: `${p.channelTitle}: ${p.stub ? 'заглушка' : p.status}` }])),
      ],
    },
    {
      id: 'A3', sev: 'mid', cases: ['SRCH-12'],
      area: '<code>GET /search/services/countries</code>',
      short: 'Всегда 503: страна с пустым <code>title</code> роняет весь ответ',
      title: 'Фасеты стран поиска всегда отвечают 503',
      body: `<dt>Эндпоинт</dt><dd><code>GET /search/services/countries</code></dd>
    <dt>По документации</dt><dd>200 со списком стран производства и счётчиками. Документированы только 200, 304, 400, 403.</dd>
    <dt>Фактически</dt><dd>${ex(out.countries).status} <code>${esc(bodyOf(out.countries)?.error?.type)}</code> (request_id <code>${esc(rid(out.countries))}</code>), статус не документирован; то же на production.${countriesCause ? ` <b>Причина по трейсу staging:</b> <code>${esc(countriesCause.class)}: ${esc(countriesCause.message)}</code> в <code>${esc(ownFrame(out.countries) ?? '?')}</code>: сервис поиска отдаёт страну с пустым названием, и валидация роняет весь список.` : ''}</dd>
    <dt>Почему важно</dt><dd>Фильтр поиска по стране в клиентах не работает. Жанры (<code>/search/services/genres</code>) при этом работают. Достаточно пропускать элементы с пустым <code>title</code>.</dd>
    <dt>Автотест</dt><dd><code>catalog/search.spec.ts</code> › «GET /search/services/countries answers an undocumented 503 E_SYSTEM_ERROR (known API bug)»</dd>`,
      exchanges: [[out.countries, { open: true }]],
    },
    {
      id: 'A4', sev: 'mid', cases: ['BLK-03', 'BLK-07'],
      area: '<code>GET /pages/{slug}/blocks/{id}</code>, <code>…/{link}</code>',
      short: 'Неизвестный блок: 503 вместо 404',
      title: 'Неизвестный блок страницы: 503 вместо 404',
      body: `<dt>Эндпоинты</dt><dd><code>GET /pages/{slug}/blocks/{id}</code> и <code>GET /pages/{slug}/blocks/{id}/{link}</code></dd>
    <dt>По документации</dt><dd>404 для неизвестного блока (для <code>…/{link}</code> прямо: «Unknown … block (<code>E_SYSTEM_ERROR</code>)» с кодом 404). 503 у обеих операций не документирован.</dd>
    <dt>Фактически</dt><dd>${ex(out.unknownBlock).status} и ${ex(out.blockLink).status} <code>E_SYSTEM_ERROR</code> (request_id <code>${esc(rid(out.unknownBlock))}</code>, <code>${esc(rid(out.blockLink))}</code>).${blockCause ? ` Причина по трейсу: <code>${esc(blockCause)}</code> — сервис коллекций отвечает 400, middleware превращает это в 503.` : ''}</dd>
    <dt>Почему важно</dt><dd>503 означает «временно, повторите» — клиент будет ретраить удалённый блок, хотя должен его просто пропустить.</dd>
    <dt>Автотесты</dt><dd><code>interface/blocks.spec.ts</code> › «an unknown block id answers an undocumented 503 instead of 404», «a link of an unknown block answers 503 instead of the documented 404»</dd>`,
      exchanges: [[out.unknownBlock, { open: true }], out.blockLink],
    },
    {
      id: 'U1', sev: 'mid', cases: ['SEC-13'],
      area: '<code>POST /login</code> и любой запрос',
      short: 'Лимит 3 сессии и <code>409 E_ANOTHER_CLIENT_IN</code> не описаны',
      title: 'Лимит одновременных сессий и 409 E_ANOTHER_CLIENT_IN не описаны',
      // Observed once while exploring the API; not replayed by capture.mjs, since
      // evicting sessions would knock the account's real devices out.
      body: `<dt>По документации</dt><dd>Ничего: ни лимита, ни статуса 409 у операций.</dd>
    <dt>Фактически</dt><dd><ul>
      <li>Повторный логин с тем же <code>device</code> + <code>serial</code> завершает предыдущую сессию этого serial (дальше <code>403 E_AUTH_ERROR</code>).</li>
      <li>У аккаунта одновременно живут 3 сессии. Четвёртый логин вытесняет самую старую: она один раз отвечает <code>409 E_ANOTHER_CLIENT_IN</code>, потом <code>403 E_AUTH_ERROR</code>.</li></ul>
      Наблюдалось 20.10.2026 при исследовании API: логины абонемента ${esc(out.meta.login)} с <code>serial</code> <code>pw-probe-n1</code>…<code>pw-probe-n4</code>, <code>device androidtv-yb-005</code>, затем <code>GET /account</code> с сессией <code>pw-probe-n1</code>:
      <pre><code>HTTP 409
x-api-error-code: 11

{"error": {"type": "E_ANOTHER_CLIENT_IN", "code": 11, "message": "Абонемент используется на другом устройстве.",
           "request_id": "01a15880-b7c8-7a58-acc6-82a57cc3c073",
           "details": {"title": null, "description": "Another client with your login was logged"}}}</code></pre>
      При сборе отчёта не повторяется: это выбило бы реальные устройства аккаунта.</dd>
    <dt>Почему важно</dt><dd>Клиенты по спецификации не знают, что 409 — это «вас вытеснили», и не покажут понятное сообщение. Стоит описать лимит и добавить 409 к операциям с сессией.</dd>
    <dt>Автотест</dt><dd>Не автоматизирован (вытеснял бы реальные устройства). Одну сессию на serial проверяет <code>account/security.spec.ts</code> › «a second login of the same device and serial ends the first session».</dd>`,
      exchanges: [],
    },
    {
      id: 'A5', sev: 'low', cases: ['GEN-05'],
      area: '19 ответов с <code>ETag</code>',
      short: 'ETag не отдаётся, 304 не бывает',
      title: 'ETag не отдаётся, условные запросы не работают',
      body: `<dt>Где</dt><dd>19 ответов документируют <code>ETag</code> и <code>304 Not Modified</code> на <code>If-None-Match</code>: каналы, избранное, блоки, поиск, EPG и др.</dd>
    <dt>Фактически</dt><dd>Ни один ответ не содержит <code>ETag</code> (staging и production); везде <code>Cache-Control: no-store, no-cache, must-revalidate, private</code>. <code>If-None-Match</code> игнорируется — ${ex(out.etagInm).status} с полным телом (№${out.etagInm}).</dd>
    <dt>Почему важно</dt><dd>Клиенты по документации не могут дёшево ревалидировать данные. Либо включить ETag, либо убрать его из спецификации.</dd>
    <dt>Автотест</dt><dd><code>other/caching.spec.ts</code> › «responses that document an ETag come without one (known API bug)»</dd>`,
      exchanges: [...out.etag, [out.etagInm, { label: 'с If-None-Match' }]],
    },
    {
      id: 'A6', sev: 'low', cases: ['BLK-10'],
      area: '<code>GET /blocks/playback</code>',
      short: '<code>limit</code> вне 1–100 не отклоняется',
      title: 'limit блока «Продолжить просмотр» не проверяется',
      body: `<dt>По документации</dt><dd><code>limit</code>: integer 1–100, по умолчанию 20; для неверных параметров документирован 400.</dd>
    <dt>Фактически</dt><dd><code>limit=0</code>, <code>101</code>, <code>-5</code> отвечают ${out.playbackLimit.map(/** @param {number} n */ (n) => ex(n).status).join(', ')}. Для сравнения, <code>GET /search/services?limit=0</code> отвечает ${ex(out.searchLimit).status} <code>${esc(bodyOf(out.searchLimit)?.error?.type)}</code> (№${out.searchLimit}).</dd>
    <dt>Автотест</dt><dd><code>interface/blocks.spec.ts</code> › «limit outside 1–100 is not rejected with the documented 400 (known API bug)»</dd>`,
      exchanges: [...out.playbackLimit, [out.searchLimit, { label: 'для сравнения' }]],
    },
    {
      id: 'A7', sev: 'low', cases: ['BLK-21'],
      area: '<code>GET /pages/radio/channel-group</code>',
      short: 'Станция с <code>kind: "channel"</code> вместо <code>"radio"</code>',
      title: 'Радиостанция в группе с kind: "channel"',
      body: `<dt>По документации</dt><dd>Элементы — <code>radioCard</code>, у которого <code>kind</code> всегда <code>"radio"</code> (const).</dd>
    <dt>Фактически</dt><dd>${wrongKind === null ? `Запрос при сборе отчёта не удался (№${out.radioGroup}, ответ ${ex(out.radioGroup).status}).` : wrongKind.length ? `${wrongKind.map((s) => `${station(s)} приходит с <code>kind: "${esc(s.kind)}"</code> и <code>play_url ${esc(s.play_url)}</code>`).join('; ')}; остальные — <code>"radio"</code>.` : 'Сейчас у всех станций <code>"radio"</code>.'} То же на production.</dd>
    <dt>Почему важно</dt><dd>Клиент, ветвящийся по <code>kind</code>, покажет станцию как ТВ-канал.</dd>
    <dt>Автотест</dt><dd><code>interface/blocks.spec.ts</code> › «radio stations come with kind "channel" (known API bug)»</dd>`,
      exchanges: [[out.radioGroup, { open: true }]],
    },
    {
      id: 'A8', sev: 'low', cases: ['RAD-02', 'RAD-03'],
      area: '<code>GET /radio</code> (deprecated)',
      short: 'Нет обязательного <code>_links.play.title</code>, <code>description: null</code>',
      title: 'Список радио (deprecated) не соответствует схеме',
      body: `<dt>По документации</dt><dd><code>_links.play</code> — схема <code>link</code> с обязательными <code>title</code> и <code>method</code>; <code>description</code> — строка.</dd>
    <dt>Фактически</dt><dd>${nullDescription === null ? `Запрос при сборе отчёта не удался (№${out.radio}, ответ ${ex(out.radio).status}).` : `У ${out.radioNoTitle} из ${out.radioTotal} станций <code>_links.play</code> без <code>title</code>; ${nullDescription.length ? `<code>description: null</code> у ${nullDescription.map(station).join(', ')}` : '<code>description: null</code> сейчас нет'}. То же на production.`}</dd>
    <dt>Автотесты</dt><dd><code>catalog/radio.spec.ts</code> › «play links have no title», «some stations have a null description»</dd>`,
      exchanges: [[out.radio, { open: true }]],
    },
    {
      id: 'D1', sev: 'doc', cases: ['SRCH-11', 'GEN-09'],
      area: 'поиск',
      short: '<code>search_url</code> / <code>next_url</code> нарушают объявленный <code>format: uri-reference</code>',
      title: 'search_url и next_url нарушают собственный формат',
      body: `<dt>Где</dt><dd><code>searchHistory.search_url</code>, <code>searchFacets.search_url</code>, <code>searchResults.next_url</code> объявлены <code>format: uri-reference</code>.</dd>
    <dt>Проблема</dt><dd><code>search_url</code> по смыслу и по примерам — шаблон (<code>/api/v4/search/services?query={query}</code>), а фигурные скобки недопустимы в uri-reference; сервер отдаёт именно шаблон, ответы не проходят схему. Пример <code>next_url</code> содержит неэкранированную кириллицу (<code>?offset=2&amp;query=простоквашино&amp;limit=2</code>) — сервер её экранирует, ошибка только в примере. Собственную схему не проходят 4 примера: <code>searchServices</code>, <code>searchServicesCountries</code>, <code>searchServicesGenres</code>, <code>getSearchHistory</code>.</dd>
    <dt>Предложение</dt><dd>Для <code>search_url</code> указать <code>format: uri-template</code> или убрать format; в примере <code>next_url</code> закодировать query.</dd>
    <dt>Автотест</dt><dd><code>other/spec-examples.spec.ts</code>, <code>catalog/search.spec.ts</code> › «search_url breaks its own documented format»</dd>`,
      exchanges: [],
    },
    {
      id: 'D2', sev: 'doc', cases: ['CNT-05'],
      area: '<code>/content/{service}/…</code>, <code>/favorites/{service}</code>',
      short: 'В перечне <code>{service}</code> нет startru и iviru, хотя карточки на них ссылаются',
      title: 'Перечень {service} не включает сервисы, на которые ссылаются карточки',
      body: `<dt>Проблема</dt><dd>Карточки дашборда <code>startru</code> и <code>iviru</code> ведут на <code>details_url /api/v4/content/startru/…</code>${out.d2details ? `, и запрос отвечает ${ex(out.d2details).status} (№${out.d2details})` : ''}, но enum параметра <code>service</code> их не содержит:
      <div class="table-wrap"><table><thead><tr><th>Операция</th><th>startru</th><th>iviru</th></tr></thead><tbody>
        <tr><td><code>GET /content/{service}/{id}</code></td><td>нет</td><td>нет</td></tr>
        <tr><td><code>GET /content/{service}/{id}/similar</code></td><td>нет</td><td>нет</td></tr>
        <tr><td><code>GET /favorites/{service}</code></td><td>нет${out.d2fav ? ` (сервер: ${ex(out.d2fav).status}, №${out.d2fav})` : ''}</td><td>нет</td></tr>
        <tr><td><code>GET …/play</code>, <code>…/episodes/…/play</code>, <code>…/trailers/…/play</code></td><td>есть</td><td>нет (ivi здесь не играет — так задумано)</td></tr>
        <tr><td><code>PUT</code>/<code>DELETE …/favorite</code>, <code>/services/{service}/…</code></td><td>есть</td><td>есть</td></tr>
      </tbody></table></div></dd>
    <dt>Предложение</dt><dd>Добавить <code>startru</code> и <code>iviru</code> в enum details / similar и решить, должен ли <code>/favorites/{service}</code> их принимать.</dd>
    <dt>Автотест</dt><dd><code>catalog/content.spec.ts</code> › «dashboard cards link to details of services the spec leaves out of {service} (known docs bug)»</dd>`,
      exchanges: [out.d2details, out.d2fav].filter(Boolean),
    },
    {
      id: 'D3', sev: 'doc', cases: ['BLK-22'],
      area: '<code>GET /blocks/client-channels</code>',
      short: 'Summary «избранные каналы», описание «самые просматриваемые»',
      title: 'Summary и описание /blocks/client-channels противоречат друг другу',
      body: `<dt>Проблема</dt><dd>Summary: «Retrieve the client's favorite-channels block», блок называется «Любимые телеканалы». Описание: «Up to 20 of the client's most-watched TV channels». Фактически блок не связан с избранным${out.d3 ? `: канал ${esc(out.d3channel.id)} «${esc(out.d3channel.title)}», только что добавленный в избранное (№${out.d3[0]}, №${out.d3[1]}), в блоке не появляется (№${out.d3[2]}); затем он убран из избранного (№${out.d3[3]})` : ''}.</dd>
    <dt>Предложение</dt><dd>Исправить summary (и, возможно, title блока), чтобы его не путали с <code>GET /favorites/channels</code>.</dd>
    <dt>Автотест</dt><dd><code>account/favorites.spec.ts</code> › «the "favorite-channels" block does not follow the favorites (known docs bug)»</dd>`,
      exchanges: out.d3 ?? [],
    },
    {
      id: 'D4', sev: 'doc', cases: ['GEN-10'],
      area: '<code>GET /radio</code>, <code>GET /radio/{id}</code>',
      short: 'Нет <code>operationId</code>',
      title: 'У операций радио нет operationId',
      body: `<dt>Проблема</dt><dd>Все 68 остальных операций имеют <code>operationId</code>; у <code>GET /radio</code> и <code>GET /radio/{id}</code> его нет — генераторы клиентов придумают имена сами.</dd>
    <dt>Автотест</dt><dd><code>other/spec-examples.spec.ts</code> › «only the deprecated radio operations have no operationId (known docs gap)»</dd>`,
      exchanges: [],
    },
  ];

  // Whether the pinned case of each finding still reproduces it in this run.
  const caseById = new Map(cases.all.map((row) => [row.ID, row]));
  const unknownCases = findings.flatMap((f) => f.cases.filter((id) => !caseById.has(id)).map((id) => `${f.id} → ${id}`));
  if (unknownCases.length) throw new Error(`Findings refer to cases TEST_CASES.md doesn't have: ${unknownCases.join(', ')}`);
  /** @param {Finding} f */
  const reproduces = (f) => {
    const statuses = f.cases.map((id) => caseById.get(id)?.result.status);
    // A red pinned test comes first: it's the cue that the bug looks fixed.
    if (statuses.some((s) => s === 'fail')) return '<span class="rs fail">не воспроизвелось — проверить</span>';
    if (f.id === 'S1' && !stagingTrace) return '<span class="rs ok">на этом хосте нет</span>';
    if (statuses.every((s) => s === 'gap')) return '<span class="rs gap">не автоматизирован</span>';
    // One case that reproduced it is enough, even if another case of the finding
    // didn't run or skipped itself.
    if (statuses.some((s) => s === 'bug')) return '<span class="rs bugrep">воспроизводится</span>';
    if (statuses.some((s) => s === 'notrun')) return '<span class="rs notrun">не проверено: тест не запускался</span>';
    if (statuses.some((s) => s === 'skip')) return '<span class="rs skip">не проверено</span>';
    if (statuses.every((s) => s === 'pass')) return '<span class="rs ok">не наблюдалось</span>';
    return '<span class="rs bugrep">воспроизводится</span>';
  };
  /** @param {Finding} f */
  const card = (f) => `<article class="bug" id="${f.id}">
  <header><span class="id">${f.id}</span><h3>${esc(f.title)}</h3><span class="sev ${f.sev}">${SEV_NAME[f.sev]}</span></header>
  <dl>${f.body}</dl>
  ${f.exchanges.length ? `<div class="cap" style="margin-top:14px">Запросы и ответы</div>${exchanges(f.exchanges)}` : ''}
</article>`;
  const byId = new Map(findings.map((f) => [f.id, f]));
  /** @param {string[]} ids */
  const cards = (ids) => ids.map((id) => card(/** @type {Finding} */ (byId.get(id)))).join('\n');
  const order = ['A1', 'S1', 'A2', 'A3', 'A4', 'U1', 'A5', 'A6', 'A7', 'A8', 'D1', 'D2', 'D3', 'D4'];
  const summaryRows = order
    .map((id) => /** @type {Finding} */ (byId.get(id)))
    .map((f) => `<tr><td><a href="#${f.id}">${f.id}</a></td><td><span class="sev ${f.sev}">${SEV_NAME[f.sev]}</span></td><td>${f.area}</td><td>${f.short}</td><td>${reproduces(f)}</td></tr>`)
    .join('\n');
  /** @param {Finding['sev']} sev */
  const sevCount = (sev) => findings.filter((f) => f.sev === sev).length;

  const { stats, tally } = cases;
  const runTotal = stats.expected + stats.flaky + stats.skipped + stats.notRun + stats.unexpected;
  /** The run's counts in words, the same in the summary and in the cases section. */
  const runCounts = [
    `${stats.expected} прошли`,
    stats.flaky ? `${stats.flaky} прошли со второй попытки` : '',
    `${stats.skipped} пропущены`,
    stats.notRun ? `${stats.notRun} не запускались` : '',
    `${stats.unexpected} упали`,
  ]
    .filter(Boolean)
    .join(', ');
  const passedCases = (tally.pass ?? 0) + (tally['pass-known'] ?? 0);
  /** @param {CaseStatus} status */
  const badge = (status) => `<span class="rs ${STATUS[status][0]}">${STATUS[status][1]}</span>`;
  const caseTables = cases.sections
    .filter((section) => section.rows.length)
    .map(
      (section) => `<h3 class="sect">${md(section.title)}</h3>
<div class="table-wrap"><table class="cases">
  <thead><tr><th>ID</th><th>Кейс</th><th>Приор.</th><th>Результат</th><th>Тесты</th><th>Примечание</th></tr></thead>
  <tbody>
${section.rows.map((row) => `    <tr><td class="cid">${esc(row.ID)}</td><td>${md(row.Title)}</td><td>${esc(row.Prio)}</td><td>${badge(row.result.status)}</td><td class="num">${esc(row.result.tests)}</td><td>${row.result.note}</td></tr>`).join('\n')}
  </tbody>
</table></div>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API v4: расхождения с документацией</title>
<style>
${CSS}</style>
</head>
<body>
<main>

<h1>API v4: расхождения с документацией</h1>
<p class="meta">
  ${esc(hostLabel)} <code>${esc(base)}</code> · запросы ${esc(utc(out.meta.at))} – ${esc(utc(out.meta.until).slice(11))} ·
  прогон тестов ${esc(utc(stats.startTime))} ·
  спецификация <a href="https://pages.kartina.tv/middleware/docs/v4/">middleware/docs/v4</a> ·
  автотесты: репозиторий <code>kartina-api-v4-tests</code>
</p>

<div class="facts">
  <div class="fact"><b>${findings.length}</b><span>находок</span></div>
  <div class="fact"><b>${sevCount('high')}</b><span>высокая серьёзность</span></div>
  <div class="fact"><b>${sevCount('mid')}</b><span>средняя</span></div>
  <div class="fact"><b>${cases.all.length}</b><span>тест-кейсов: <a href="#cases">${passedCases} пройдены, ${tally.bug ?? 0} — баг воспроизводится, ${tally.skip ?? 0} пропущены${tally.notrun ? `, ${tally.notrun} не запускались` : ''}, ${tally.gap ?? 0} не автоматизированы${tally.fail ? `, ${tally.fail} упали` : ''}</a></span></div>
  <div class="fact"><b>${runTotal}</b><span>автотестов: ${runCounts}</span></div>
</div>

<p>Каждая находка закреплена автотестом: тест проверяет текущее (неверное) поведение и упадёт,
когда его исправят. Ниже у каждой находки — <b>все запросы ровно в том виде, в каком они
отправлялись</b> (готовые <code>curl</code>; пароль в отчёт не включён), и полные ответы сервера с
заголовками; по <code>request_id</code> и времени их можно найти в логах. Все запросы шли в одной
сессии (№${out.login}), закрытой в конце: logout №${out.logout}, после него сервер её уже не принимает (№${out.after}).</p>

<h2>Сводка</h2>
<div class="table-wrap">
<table>
  <thead><tr><th>ID</th><th>Серьёзность</th><th>Эндпоинт</th><th>Суть</th><th>В этом прогоне</th></tr></thead>
  <tbody>
${summaryRows}
  </tbody>
</table>
</div>

<h2>Сессия</h2>
<dl class="bug session">
  <dt>Абонемент</dt><dd><code>${esc(out.meta.login)}</code> (пароль в отчёт не включён)</dd>
  <dt>Устройство</dt><dd><code>device ${esc(out.meta.device)}</code>, <code>serial ${esc(out.meta.serial)}</code></dd>
  <dt>MW_SSID</dt><dd><code>${esc(out.meta.ssid)}</code> (${out.sessionClosed ? `закрыта: №${out.logout}, проверено в №${out.after}` : '<b>НЕ ЗАКРЫТА</b>'})</dd>
</dl>
${exchanges([[out.login, { open: true, label: 'логин' }], [out.logout, { label: 'logout в конце' }], [out.after, { label: 'сессия больше не действует' }]])}

<h2>Нарушения контракта</h2>
${cards(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'])}

<h2>Безопасность и окружение</h2>
${cards(['S1', 'U1'])}

<h2>Ошибки в документации</h2>
${cards(['D1', 'D2', 'D3', 'D4'])}

<h2 id="cases">Результаты прогона тест-кейсов</h2>
<p class="meta">Прогон ${esc(utc(stats.startTime))}, ${Math.round(stats.duration / 1000)} с, ${esc(base)}.
${runTotal} автотестов: ${runCounts}.
Кейсы и причины пробелов — из <code>TEST_CASES.md</code> репозитория тестов; тест относится к кейсу по тегу: <code>npx playwright test --grep @CNT-11</code> прогоняет один кейс, для кейса, меняющего аккаунт, — <code>V4_MUTATING_ONLY=1 npx playwright test --project=api-v4-mutating --grep @FAV-05</code>.</p>
<div class="facts">
  <div class="fact"><b>${cases.all.length}</b><span>тест-кейсов</span></div>
  <div class="fact"><b>${passedCases}</b><span>пройдены (из них ${tally['pass-known'] ?? 0} с допущенным известным расхождением)</span></div>
  <div class="fact"><b>${tally.bug ?? 0}</b><span>закреплённых багов воспроизводятся</span></div>
  <div class="fact"><b>${tally.skip ?? 0}</b><span>пропущены (нет нужных данных)</span></div>
  <div class="fact"><b>${tally.notrun ?? 0}</b><span>не запускались (упал тест, от которого они зависят, или прогон прерван)</span></div>
  <div class="fact"><b>${tally.gap ?? 0}</b><span>не автоматизированы</span></div>
  <div class="fact"><b>${tally.fail ?? 0}</b><span>упали</span></div>
</div>
<p class="legend">${badge('pass')} всё как в документации · ${badge('pass-known')} кейс выполнен, но в ответах есть известное расхождение из этого отчёта (на нём кейс не падает) ·
${badge('bug')} кейс закрепляет баг: тест зелёный, пока баг есть · ${badge('skip')} нужных данных сейчас нет · ${badge('notrun')} тест не запускался, причина в примечании · ${badge('gap')} причина в примечании</p>
${caseTables}

<h2>Что проверено и что нет</h2>
<ul>
  <li><b>Покрытие:</b> все 70 операций спецификации; ${runTotal} автотестов по ${cases.all.length} тест-кейсам (<a href="#cases">результаты</a>), каталог — <code>TEST_CASES.md</code> в репозитории тестов.</li>
  <li><b>Production</b> (<code>iptv.kartina.tv</code>), разовая проверка 20.10.2026, не из этого прогона: только чтение; A3, A5, A7, A8, D1 воспроизводились там же, S1 — нет. A1 и A2 на production не проверялись.</li>
  <li><b>Не проверено:</b> пропускает ли эндпоинт трейлера (A1) проверки подписки и гео — у тестового аккаунта всё оплачено.</li>
  <li><b>Сознательно не тестировалось</b> (меняет реальный аккаунт или затрагивает других): отправка кодов и создание аккаунтов sharing, смена protect-кода, очистка истории поиска, ответ на registration prompt, вытеснение сессий, неверный пароль реального аккаунта.</li>
</ul>

</main>
</body>
</html>
`;
}
