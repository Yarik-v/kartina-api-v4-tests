// `npm run seed:playback`: fills the account's "continue watching" block, which BLK-11
// (/blocks/playback/channels) and BLK-12 (/blocks/playback/premierone) need, by real
// playback in the web client: the API has no call that records progress (the client
// reports it to shot.kartina.stream every minute). The block keeps only the last 14
// days, so this has to be repeated about every two weeks. An origin that already has
// entries is left alone unless `--force` is passed.
import 'dotenv/config';
import { chromium } from '@playwright/test';
import { isStaging, v4Login, v4Origin, v4Password, v4UiOrigin } from '../src/env.mjs';

/** Watched per title: entries under 90 s don't count. */
const WATCH_SECONDS = 120;
const force = process.argv.includes('--force');

if (!isStaging) throw new Error('playtest.kartina.tv talks to staging (rustvt.kartina.tv) only: set V4_API_HOST accordingly');
if (!v4Login || !v4Password) throw new Error('Set V4_LOGIN and V4_PASSWORD in .env');

const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 720 } })).newPage();
await page.addLocatorHandler(page.locator('#cmpbox'), async (banner) => {
  await banner.locator('.cmpboxbtnno').click();
});

/** GET on the client's own session (the browser's cookie). */
const api = async (/** @type {string} */ path) => {
  const res = await page.request.get(v4Origin + path);
  if (!res.ok()) throw new Error(`GET ${path} answered ${res.status()}`);
  return res.json();
};
/** The client logs in again on every page load; its old cookie is dead until then. */
const load = async (/** @type {string} */ path) => {
  const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
  await page.goto(v4UiOrigin + path);
  if ((await login).status() !== 200) throw new Error(`The client's login on ${path} failed`);
};
const secondsPlayed = () => page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('video'), (v) => v.currentTime)));
const watch = async (/** @type {string} */ what) => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.currentTime > 1), null, { timeout: 60_000 });
  const start = await secondsPlayed();
  await page.waitForTimeout(WATCH_SECONDS * 1000);
  const played = Math.round((await secondsPlayed()) - start);
  if (played < 90) throw new Error(`${what}: only ${played} s played, under the 90 s the block needs`);
  console.log(`  ${what}: ${played} s watched`);
};
const entries = async (/** @type {string} */ origin) => (await api(`/blocks/playback/${origin}`)).items;

/** The first episode of a premierone title nobody started. */
async function seedPremierone() {
  const found = await api('/search/services?service=premierone&limit=50');
  const title = found.items.find((/** @type {any} */ item) => item.playable && !item.progress);
  if (!title) throw new Error('No unstarted premierone title in the search');
  await load(`/home/itm?itm=${encodeURIComponent(Buffer.from(`premierone/${title.id}`).toString('base64'))}`);
  // «Смотреть» is a link here, not a button.
  await page.locator('a.main-button').filter({ hasText: /^\s*(Смотреть|Продолжить)/ }).first().click();
  await watch(`premierone «${title.title}»`);
}

/** A programme that ended over 3 h ago, from the channel page, as a viewer picks it. */
async function seedChannels() {
  const now = Date.now() / 1000;
  // The channel page writes "8:05": hours without a leading zero.
  const time = (/** @type {number} */ ts) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
  const row = (/** @type {any} */ p) => `${p.title} ${time(p.starts_at)} - ${time(p.ends_at)}`;
  const channels = (await api('/channels')).items.filter((/** @type {any} */ c) => c.playable && !c.access.protected && c.capabilities.archive);
  for (const channel of channels.slice(0, 5)) {
    const epg = (await api(`/channels/${channel.id}/epg?from=${Math.floor(now - 86400)}&to=${Math.floor(now)}`)).items;
    // The page lists every EPG day in one list: the row must be the only one like it.
    const programme = epg
      .filter((/** @type {any} */ p) => p.playable && p.ends_at < now - 3 * 3600 && epg.filter((/** @type {any} */ q) => row(q) === row(p)).length === 1)
      .at(-1);
    if (!programme) continue;
    await load(`/tv/channel/${channel.id}/live`);
    // Picked before the live stream starts, the recording stays paused.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).some((v) => v.currentTime > 0), null, { timeout: 60_000 });
    await page.locator('.video-list__item').filter({ hasText: programme.title }).filter({ hasText: `${time(programme.starts_at)} - ${time(programme.ends_at)}` }).first().click();
    await page.waitForURL(/\/(archive|teleteka)\//);
    await watch(`${channel.title}: «${programme.title}»`);
    return;
  }
  throw new Error('None of the first archive channels has a programme to pick');
}

let failed = false;
try {
  await page.goto(`${v4UiOrigin}/login`);
  await page.getByPlaceholder('Номер абонемента').fill(v4Login);
  await page.getByPlaceholder('Пароль').fill(v4Password);
  const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
  await page.keyboard.press('Enter');
  if ((await login).status() !== 200) throw new Error('Login through the form failed');
  await page.waitForURL(/\/home/);

  for (const [origin, seed] of /** @type {const} */ ([['premierone', seedPremierone], ['channels', seedChannels]])) {
    const before = await entries(origin);
    if (before.length && !force) {
      console.log(`/blocks/playback/${origin}: ${before.length} entries already, left alone (--force to add one)`);
      continue;
    }
    console.log(`/blocks/playback/${origin}: watching…`);
    await seed();
  }
  // Leaving the player sends the last position.
  await load('/home');
  await page.waitForTimeout(5000);
  for (const origin of ['premierone', 'channels']) {
    const after = await entries(origin);
    console.log(`/blocks/playback/${origin}: ${after.map((/** @type {any} */ item) => `«${item.title}»`).join(', ') || 'still empty'}`);
    if (!after.length) failed = true;
  }
} finally {
  // The run's browser session must not stay among the account's few slots.
  const logout = await page.request.post(`${v4Origin}/logout`);
  const after = await page.request.get(`${v4Origin}/account`);
  await browser.close();
  if (after.status() !== 403) {
    console.error(`⚠ The browser session may still be open: POST /logout ${logout.status()}, then GET /account ${after.status()}`);
    failed = true;
  }
}
if (failed) process.exit(1);
