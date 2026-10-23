import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { V4ApiClient, apiPath } from '../src/client';
import { assertValidV4Host } from '../src/config';
import { operationForPath } from '../src/spec';
import type { Account, Block, BlockSummary, ChannelsList, ContentCard, ContentDetails, Page, Service } from '../src/types';
import { EMPTY_STORAGE_STATE, NO_SESSION_REASON, NO_SESSION_TAG, hasV4Session } from './session';

/** A fetched-once response paired with its parsed body, shared across every test in a worker. */
export interface Cached<T> {
  res: APIResponse;
  body: T;
}

/** A dashboard block, fetched from its `block_url` the way a client would. */
export interface LoadedBlock extends Cached<Block> {
  summary: BlockSummary;
  /** The documented operation `block_url` points at (page block, playback, client channels...). */
  operationId: string;
}

// Blocks are fetched a few at a time, not all at once: with every worker fanning
// out ~30 requests together, the staging gateway starts answering 503.
const BLOCK_FETCH_CONCURRENCY = 4;

// The dashboard crawl (~30 blocks) and sample-title lookups are slow on staging. Their
// own timeout keeps that time off the 30 s of the first test that needs them.
const FIXTURE_TIMEOUT = 120_000;

export interface DiscoveredTitle {
  card: ContentCard;
  details: ContentDetails;
}

/** The dashboard, the one page every installation has. */
export const DASHBOARD_SLUG = 'dashboard';

/** Every contentCard across `blocks` matching `predicate`, in dashboard order, without repeats. */
export function findCards(blocks: LoadedBlock[], predicate: (card: ContentCard) => boolean): ContentCard[] {
  const seen = new Set<string>();
  const cards: ContentCard[] = [];
  for (const { body } of blocks) {
    for (const card of body.items) {
      const key = `${card.service}/${card.id}`;
      if (!card.details_url || seen.has(key) || !predicate(card)) continue;
      seen.add(key);
      cards.push(card);
    }
  }
  return cards;
}

async function okJson<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`Fixture setup failed: ${what} returned ${res.status()}: ${await res.text()}`);
  return res.json();
}

/** The `undo` fixture: registers a step that puts the account back after the test. */
export type Undo = (step: () => Promise<unknown>) => void;

interface Fixtures {
  /** Skips the test without a session, unless it's tagged `@no-session`. */
  sessionGate: void;
  /** Client on the shared session. */
  api: V4ApiClient;
  /**
   * Cookie-less client of its own: for anonymous answers, and for login/logout tests
   * whose Set-Cookie must never reach the shared session.
   */
  anonApi: V4ApiClient;
  /** Another cookie-less client per call, for tests that juggle several sessions. */
  newAnonApi: () => Promise<V4ApiClient>;
  /**
   * Registers a step that puts the account back. Register it BEFORE the change, so a
   * change applied but answered unexpectedly is still undone. Steps run after the test
   * in reverse order, also on failure or timeout; a throwing step fails the test.
   */
  undo: Undo;
}

interface WorkerFixtures {
  /** Auto: fails every api-v4 test with one clear message if V4_API_HOST isn't allowed. */
  validV4Host: void;
  /** Whether the setup opened the shared session; read once per worker. */
  hasSession: boolean;
  workerRequest: APIRequestContext;
  workerApi: V4ApiClient;
  /** GET /account, once per worker. */
  account: Account;
  /** GET /services, once per worker. */
  services: Service[];
  /** GET /channels, once per worker. */
  channels: ChannelsList;
  /** GET /pages/dashboard, once per worker. */
  dashboard: Page;
  /** Every block of the dashboard, in page order, once per worker. */
  dashboardBlocks: LoadedBlock[];
  /** Ids of the services this account is subscribed to. */
  subscribedServices: Set<string>;
  /** A playable movie of a subscribed service with its details, or `null` if the dashboard has none (dependent tests skip). */
  sampleMovie: DiscoveredTitle | null;
  /** Like `sampleMovie`, for a series whose first season lists episodes. */
  sampleSeries: DiscoveredTitle | null;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  validV4Host: [
    async ({}, use) => {
      assertValidV4Host();
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  hasSession: [
    async ({}, use) => {
      await use(hasV4Session());
    },
    { scope: 'worker' },
  ],

  sessionGate: [
    async ({ hasSession }, use, testInfo) => {
      testInfo.skip(!testInfo.tags.includes(NO_SESSION_TAG) && !hasSession, NO_SESSION_REASON);
      await use();
    },
    { auto: true },
  ],

  api: async ({ request }, use) => {
    await use(new V4ApiClient(request));
  },

  // Depends on `api` so it's torn down first, while the session's context is still
  // open; a `finally` in the test body would run against a disposed context after a timeout.
  undo: async ({ api }, use) => {
    void api;
    const steps: (() => Promise<unknown>)[] = [];
    await use((step) => {
      steps.push(step);
    });
    const errors: unknown[] = [];
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (error) {
        errors.push(error);
      }
    }
    // Report every failed step: each names what was left on the account.
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const messages = errors.map((error) => (error instanceof Error ? error.message : String(error)));
      throw new Error(`${errors.length} undo steps failed:\n\n${messages.join('\n\n')}`);
    }
  },

  anonApi: async ({ newAnonApi }, use) => {
    await use(await newAnonApi());
  },

  newAnonApi: async ({ playwright }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async () => {
      const context = await playwright.request.newContext({ storageState: EMPTY_STORAGE_STATE });
      contexts.push(context);
      return new V4ApiClient(context);
    });
    // A test that failed before its own logout would hold one of the account's few
    // session slots for the cookie's three days.
    await Promise.all(
      contexts.map(async (context) => {
        const { cookies } = await context.storageState();
        if (cookies.some((cookie) => cookie.name === 'MW_SSID')) await new V4ApiClient(context).logout();
        await context.dispose();
      }),
    );
  },

  workerRequest: [
    async ({ playwright, hasSession }, use, workerInfo) => {
      // The project's request options (storage state included), so worker fixtures send what `request` does.
      const { baseURL, extraHTTPHeaders, ignoreHTTPSErrors, proxy, storageState } = workerInfo.project.use;
      const context = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders,
        ignoreHTTPSErrors,
        proxy,
        storageState: hasSession ? storageState : EMPTY_STORAGE_STATE,
      });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  workerApi: [
    async ({ workerRequest }, use) => {
      await use(new V4ApiClient(workerRequest));
    },
    { scope: 'worker' },
  ],

  account: [
    async ({ workerApi }, use) => {
      await use(await okJson<Account>(await workerApi.getAccount(), 'GET /account'));
    },
    { scope: 'worker' },
  ],

  services: [
    async ({ workerApi }, use) => {
      await use(await okJson<Service[]>(await workerApi.getServices(), 'GET /services'));
    },
    { scope: 'worker' },
  ],

  channels: [
    async ({ workerApi }, use) => {
      await use(await okJson<ChannelsList>(await workerApi.getChannels(), 'GET /channels'));
    },
    { scope: 'worker' },
  ],

  dashboard: [
    async ({ workerApi }, use) => {
      await use(await okJson<Page>(await workerApi.getPage(DASHBOARD_SLUG), `GET /pages/${DASHBOARD_SLUG}`));
    },
    { scope: 'worker' },
  ],

  dashboardBlocks: [
    async ({ workerApi, dashboard }, use) => {
      // A block that fails to load fails the fixture rather than silently shrinking the data.
      const blocks: LoadedBlock[] = new Array(dashboard.items.length);
      let next = 0;
      const worker = async () => {
        while (next < dashboard.items.length) {
          const index = next++;
          const summary = dashboard.items[index];
          const operationId = operationForPath('GET', summary.block_url)?.id;
          if (!operationId) throw new Error(`Block ${summary.id} links to an undocumented ${summary.block_url}`);
          const res = await workerApi.raw('GET', apiPath(summary.block_url));
          blocks[index] = { summary, operationId, res, body: await okJson<Block>(res, `GET ${summary.block_url}`) };
        }
      };
      await Promise.all(Array.from({ length: BLOCK_FETCH_CONCURRENCY }, worker));
      await use(blocks);
    },
    { scope: 'worker', timeout: FIXTURE_TIMEOUT },
  ],

  subscribedServices: [
    async ({ services }, use) => {
      await use(new Set(services.filter((s) => s.access.state === 'subscribed').map((s) => s.id)));
    },
    { scope: 'worker' },
  ],

  sampleMovie: [
    async ({ workerApi, dashboardBlocks, subscribedServices }, use) => {
      const candidates = findCards(dashboardBlocks, (c) => c.kind === 'movie' && c.playable && subscribedServices.has(c.service));
      await use(await firstWithDetails(workerApi, candidates, (details) => details.playable));
    },
    { scope: 'worker', timeout: FIXTURE_TIMEOUT },
  ],

  sampleSeries: [
    async ({ workerApi, dashboardBlocks, subscribedServices }, use) => {
      const candidates = findCards(dashboardBlocks, (c) => c.kind === 'series' && c.playable && subscribedServices.has(c.service));
      await use(
        await firstWithDetails(workerApi, candidates, (details) => details.playable && (details.seasons[0]?.episodes.length ?? 0) > 0),
      );
    },
    { scope: 'worker', timeout: FIXTURE_TIMEOUT },
  ],
});

/** The first of (at most five) `candidates` whose details load and pass `accept`. */
async function firstWithDetails(
  api: V4ApiClient,
  candidates: ContentCard[],
  accept: (details: ContentDetails) => boolean,
): Promise<DiscoveredTitle | null> {
  for (const card of candidates.slice(0, 5)) {
    const res = await api.getContentDetails(card.service, card.id);
    if (!res.ok()) continue;
    const details: ContentDetails = await res.json();
    if (accept(details)) return { card, details };
  }
  return null;
}

export { expect };
