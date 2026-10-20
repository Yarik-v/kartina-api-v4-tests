import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { V4ApiClient } from '../src/client';
import { assertValidV4Host, v4Device, v4Login, v4Password, v4Serial } from '../src/config';
import { EMPTY_STORAGE_STATE, NO_SESSION_REASON, V4_SESSION_FILE } from './session';

// One login for the whole run, shared by every worker through the storage state. Not
// one per worker: a login ends the previous session of the same serial, and the
// account holds only a few sessions at once (a new one pushes the oldest out, which
// then answers 409 E_ANOTHER_CLIENT_IN), so per-worker logins would knock each other
// and the account's real devices out.
setup('open the shared API v4 session', async ({ playwright }) => {
  assertValidV4Host();
  await mkdir(path.dirname(V4_SESSION_FILE), { recursive: true });
  // Written up front, so a run without credentials (or a failed login) never leaves
  // the previous run's session behind for the tests to pick up.
  await writeFile(V4_SESSION_FILE, JSON.stringify(EMPTY_STORAGE_STATE));
  setup.skip(!v4Login || !v4Password, NO_SESSION_REASON);

  const context = await playwright.request.newContext({ storageState: EMPTY_STORAGE_STATE });
  const res = await new V4ApiClient(context).login({
    login: v4Login,
    password: v4Password,
    device: v4Device,
    serial: v4Serial,
  });
  expect(res.status(), `POST /login with V4_LOGIN / V4_PASSWORD: ${await res.text()}`).toBe(200);
  await context.storageState({ path: V4_SESSION_FILE });
  await context.dispose();
});
