import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { V4ApiClient } from '../src/client';
import { isStaging, v4UiOrigin } from '../src/config';
import { runUndo, type Undo } from '../src/undo';
import { NO_SESSION_TAG } from '../tests/session';
import { BROWSER_NO_SESSION_REASON, hasBrowserSession } from './session';

// Fixtures and helpers for the browser-ui project: the web client at playtest.kartina.tv,
// which talks to API v4 on staging. The project's baseURL is the API, not the site: so
// `page.request`, which shares the browser's cookies, reaches API v4 with the very
// session the client is using, and `uiApi` (a V4ApiClient on it) gives each test the
// data to compare the UI with. Pages are opened with absolute URLs (`openHome`).
// Several helpers come from the sibling Free API repo's ui-tests, which drive the same
// client: its quirks were found there.

interface UiFixtures {
  /** Auto: skips off staging, and without a browser session unless the test is tagged `@no-session`. */
  uiGate: void;
  /** API v4 on the browser's own session. */
  uiApi: V4ApiClient;
  undo: Undo;
}

export const test = base.extend<UiFixtures>({
  uiGate: [
    async ({}, use, testInfo) => {
      testInfo.skip(!isStaging, 'playtest.kartina.tv talks to staging (rustvt.kartina.tv) only');
      testInfo.skip(!testInfo.tags.includes(NO_SESSION_TAG) && !hasBrowserSession(), BROWSER_NO_SESSION_REASON);
      await use();
    },
    { auto: true },
  ],

  page: async ({ page }, use) => {
    // The consentmanager banner slides over the bottom of the page and swallows clicks
    // there; whenever it shows up, it's dismissed with "Отклонить все".
    await page.addLocatorHandler(page.locator('#cmpbox'), async (banner) => {
      await banner.locator('.cmpboxbtnno').click();
    });
    await use(page);
  },

  uiApi: async ({ page }, use) => {
    await use(new V4ApiClient(page.request));
  },

  // Depends on `uiApi` (and so on the page's context), which stays open until every
  // step has run.
  undo: async ({ uiApi }, use) => {
    void uiApi;
    await runUndo(use);
  },
});

/** "Смотреть", or "Продолжить: HH:MM" once the account has progress on the title. */
export const WATCH_BUTTON_NAME = /^(Смотреть|Продолжить)/;

/**
 * Loads a page of the client (`/home`, `/settings/account`) and waits for the login it
 * makes on every page load: until it's done, the browser's cookie is the previous
 * session's, which the page load has just ended, so `uiApi` must not be used before.
 */
export async function openPage(page: Page, path: string): Promise<void> {
  const login = page.waitForResponse((res) => res.url().endsWith('/api/v4/login') && res.request().method() === 'POST');
  await page.goto(`${v4UiOrigin}${path}`);
  expect((await login).status(), `the client's login on loading ${path}`).toBe(200);
}

/**
 * Opens the dashboard and waits until it has data, not just its shell. If the client
 * lands on the login form instead, the saved session wasn't accepted, which fails the
 * test rather than skipping it.
 */
export async function openHome(page: Page): Promise<void> {
  await openPage(page, '/home');
  const loginField = page.getByPlaceholder('Номер абонемента');
  const watchButton = page.getByRole('button', { name: WATCH_BUTTON_NAME }).first();
  await loginField.or(watchButton).first().waitFor();
  expect(await loginField.isVisible(), 'the client asked to log in again: the saved browser session was not accepted').toBe(false);
}

/**
 * Hovers a top-nav dropdown (Телевидение, Видеотека, Радио) open. Scoped to the header
 * and matched exactly: hidden popovers elsewhere carry the same labels, and the real
 * text has surrounding spaces.
 */
export async function hoverNavDropdown(page: Page, label: string): Promise<void> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.locator('header .item.dropdown-icon', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }).hover();
}

/** Seconds played by the page's video: it has more than one <video> (one stays hidden), any playing counts. */
export function secondsPlayed(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('video'), (v) => v.currentTime)));
}

/** The title-details banner (/home/itm, /favorites/itm): heading, tags, description, buttons. */
export function titleBanner(page: Page): Locator {
  return page.locator('.banner__info__content');
}

/** The banner's own heading (`.title` alone also matches hidden dropdown rows). */
export function titleHeading(page: Page): Locator {
  return titleBanner(page).locator('.title');
}

/** How long one dashboard row may take to replace its placeholders with cards. */
const ROW_LOAD_TIMEOUT = 20_000;

/**
 * The dashboard's first title card: a real `<a href="/home/itm?...">` link. Rows load
 * their cards only once scrolled near the viewport, so the first rows are walked
 * top-down, each waited on until it settles (a title card, or no `.animation--shine`
 * placeholders left), and the first one with title cards wins. A slow row is never
 * passed over for a faster one below it.
 */
export async function firstTitleCard(page: Page): Promise<Locator> {
  const rows = page.locator('.video-slider');
  await rows.first().waitFor();
  for (const row of (await rows.all()).slice(0, 5)) {
    const card = row.locator('a.video-item__link[href^="/home/itm"]').first();
    const placeholder = row.locator('.animation--shine').first();
    await row.scrollIntoViewIfNeeded();
    const rowState = async () =>
      (await card.count()) > 0 ? 'has titles' : (await placeholder.count()) > 0 ? 'loading' : 'no titles';
    if ((await rowState()) === 'loading') test.info().setTimeout(test.info().timeout + ROW_LOAD_TIMEOUT);
    await expect.poll(rowState, { message: 'dashboard row still loading', timeout: ROW_LOAD_TIMEOUT }).not.toBe('loading');
    if ((await card.count()) > 0) return card;
  }
  throw new Error('None of the first 5 dashboard rows has title cards.');
}

/**
 * The title a details page shows: its `itm` parameter is base64 of "{service}/{id}"
 * (e.g. `mediateka/68ce7934048b9d7961081e9b`).
 */
export function titleOfDetailsUrl(url: string): { service: string; id: string } {
  const itm = new URL(url).searchParams.get('itm');
  if (!itm) throw new Error(`No itm parameter in ${url}`);
  const [service, id] = Buffer.from(itm, 'base64').toString('utf8').split('/');
  if (!service || !id) throw new Error(`itm of ${url} is not "{service}/{id}"`);
  return { service, id };
}

/**
 * Opens the first title's details page with a real click (the SPA router ignores
 * script-dispatched clicks) and returns the title it shows.
 */
export async function openFirstTitleDetails(page: Page): Promise<{ service: string; id: string }> {
  await (await firstTitleCard(page)).click();
  await page.waitForURL(/\/home\/itm/);
  await expect(titleHeading(page)).not.toBeEmpty();
  return titleOfDetailsUrl(page.url());
}

export { expect };
