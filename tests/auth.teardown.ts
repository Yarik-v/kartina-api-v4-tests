import { writeFile } from 'node:fs/promises';
import { test as teardown, expect } from '@playwright/test';
import { V4ApiClient } from '../src/client';
import { EMPTY_STORAGE_STATE, V4_SESSION_FILE, hasV4Session } from './session';

// Ends the shared session, so it doesn't hold one of the account's few slots for three days.
teardown('close the shared API v4 session', async ({ request }) => {
  teardown.skip(!hasV4Session(), 'No session was opened');
  const res = await new V4ApiClient(request).logout();
  expect(res.status(), 'POST /logout of the shared session').toBe(204);
  await writeFile(V4_SESSION_FILE, JSON.stringify(EMPTY_STORAGE_STATE));
});
