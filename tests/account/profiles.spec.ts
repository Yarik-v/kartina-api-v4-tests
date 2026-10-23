import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import { V4ApiClient } from '../../src/client';
import type { Profile, ProfilePayload } from '../../src/types';
import { NO_SESSION_REASON } from '../session';

interface ProfileList {
  count: number;
  items: Profile[];
}

// The suite's profiles carry this prefix, so a run can remove an interrupted run's
// leftovers without touching the account's own profiles.
const PREFIX = 'pw-';
const MAX_PROFILES = 5;

async function listProfiles(api: V4ApiClient): Promise<ProfileList> {
  return expectResponse<ProfileList>(await api.listProfiles(), 'listProfiles', 200);
}

async function createProfile(api: V4ApiClient, payload: ProfilePayload): Promise<Profile> {
  return expectResponse<Profile>(await api.createProfile(payload), 'createProfile', 201);
}

async function deleteSuiteProfiles(api: V4ApiClient): Promise<void> {
  for (const profile of (await listProfiles(api)).items) {
    if (!profile.is_main && profile.name?.startsWith(PREFIX)) await api.deleteProfile(profile.id);
  }
}

/** The `undo` step of every test that may create a profile: none of the suite's is left. */
const noSuiteProfilesLeft = (api: V4ApiClient) => async () => {
  await deleteSuiteProfiles(api);
  const left = (await listProfiles(api)).items.filter((profile) => profile.name?.startsWith(PREFIX));
  expect(left.map((profile) => profile.id), 'profiles the suite created, still there').toEqual([]);
};

/** The `undo` step of every test that may switch the profile: the session acts as the main one again. */
const backToMainProfile = (api: V4ApiClient, mainId: number) => async () => {
  const current = await expectResponse<Profile>(await api.getCurrentProfile(), 'getCurrentProfile', 200);
  if (current.id !== mainId) await expectResponse(await api.switchCurrentProfile({ profile_id: mainId }), 'switchCurrentProfile', 200);
};

// The profile list is shared state: these tests run in api-v4-mutating. Every test
// that creates or switches registers its clean-up with `undo` first; the beforeAll
// removes what an interrupted earlier run left behind.
test.describe.configure({ mode: 'default' });

test.beforeAll(async ({ playwright, hasSession }) => {
  test.skip(!hasSession, NO_SESSION_REASON);
  // On the shared session: the project's storage state applies to this context too.
  const context = await playwright.request.newContext();
  await deleteSuiteProfiles(new V4ApiClient(context));
  await context.dispose();
});

test.describe('GET /profiles', { tag: '@mutates' }, () => {
  test('lists the profiles with exactly one main profile', { tag: '@PRF-01' }, async ({ api }) => {
    const body = await listProfiles(api);
    expect(body.count).toBe(body.items.length);
    expect(body.items.filter((profile) => profile.is_main)).toHaveLength(1);
    expect(new Set(body.items.map((profile) => profile.id)).size, 'unique ids').toBe(body.items.length);
    expect(body.count).toBeLessThanOrEqual(MAX_PROFILES);
  });

  test('GET /profiles/current of a fresh session is the main profile', { tag: '@PRF-02' }, async ({ api }) => {
    const current = await expectResponse<Profile>(await api.getCurrentProfile(), 'getCurrentProfile', 200);
    expect(current.is_main).toBe(true);
  });

  test('GET /profiles/{id} returns the same profile the list does', { tag: '@PRF-03' }, async ({ api }) => {
    const main = (await listProfiles(api)).items.find((profile) => profile.is_main)!;
    const body = await expectResponse<Profile>(await api.getProfile(main.id), 'getProfile', 200);
    expect(body).toEqual(main);
  });

  test('GET /profiles/{id} of a profile that is not this subscription\'s answers 404', { tag: '@PRF-04' }, async ({ api }) => {
    await expectError(await api.getProfile(1), 'getProfile', 404);
  });
});

test.describe('profile lifecycle', { tag: '@mutates' }, () => {
  test('create, read, replace, update, switch to and delete an additional profile', { tag: '@PRF-05' }, async ({ api, undo }) => {
    const main = (await listProfiles(api)).items.find((profile) => profile.is_main)!;
    undo(noSuiteProfilesLeft(api));
    undo(backToMainProfile(api, main.id));
    const created = await createProfile(api, { name: `${PREFIX}kids`, avatar: 'avatar_2', age_band: 12 });
    expect(created).toMatchObject({ is_main: false, name: `${PREFIX}kids`, avatar: 'avatar_2', age_band: 12 });
    expect((await listProfiles(api)).items.map((profile) => profile.id)).toContain(created.id);
    expect(await expectResponse<Profile>(await api.getProfile(created.id), 'getProfile', 200)).toEqual(created);

    // PUT is a full replace: an omitted avatar resets to `default`.
    const replaced = await expectResponse<Profile>(
      await api.replaceProfile(created.id, { name: `${PREFIX}teens`, age_band: 16 }),
      'replaceProfile',
      200,
    );
    expect(replaced).toMatchObject({ id: created.id, name: `${PREFIX}teens`, avatar: 'default', age_band: 16 });

    // PATCH is documented as a synonym of PUT.
    const updated = await expectResponse<Profile>(
      await api.updateProfile(created.id, { name: `${PREFIX}teens`, avatar: 'avatar_3', age_band: 7 }),
      'updateProfile',
      200,
    );
    expect(updated).toMatchObject({ id: created.id, avatar: 'avatar_3', age_band: 7 });

    const switched = await expectResponse<Profile>(
      await api.switchCurrentProfile({ profile_id: created.id }),
      'switchCurrentProfile',
      200,
    );
    expect(switched.id).toBe(created.id);
    expect((await expectResponse<Profile>(await api.getCurrentProfile(), 'getCurrentProfile', 200)).id).toBe(created.id);
    await expectResponse(await api.deleteProfile(created.id), 'deleteProfile', 204);

    // Deleting the profile the session acts as falls back to the main one.
    const current = await expectResponse<Profile>(await api.getCurrentProfile(), 'getCurrentProfile', 200);
    expect(current.is_main, 'session fell back to the main profile').toBe(true);
    await expectError(await api.getProfile(created.id), 'getProfile', 404);
    await expectError(await api.deleteProfile(created.id), 'deleteProfile', 404);
  });

  test('DELETE /profiles/{id} answers 204 with no body', { tag: '@PRF-06' }, async ({ api, undo }) => {
    undo(noSuiteProfilesLeft(api));
    const created = await createProfile(api, { name: `${PREFIX}delete`, age_band: 0 });
    await expectResponse(await api.deleteProfile(created.id), 'deleteProfile', 204);
  });

  test('the main profile cannot be deleted: 409 E_NOT_ALLOWED', { tag: '@PRF-07' }, async ({ api }) => {
    const main = (await listProfiles(api)).items.find((profile) => profile.is_main)!;
    await expectError(await api.deleteProfile(main.id), 'deleteProfile', 409, 'E_NOT_ALLOWED');
  });

  test('a sixth profile is refused with 409 E_LIMIT_EXCEEDED', { tag: '@PRF-08' }, async ({ api, undo }) => {
    // Also takes back a sixth profile, should the server create it after all.
    undo(noSuiteProfilesLeft(api));
    const { count } = await listProfiles(api);
    for (let i = count; i < MAX_PROFILES; i++) {
      await createProfile(api, { name: `${PREFIX}limit-${i}`, age_band: 0 });
    }
    await expectError(
      await api.createProfile({ name: `${PREFIX}limit-extra`, age_band: 0 }),
      'createProfile',
      409,
      'E_LIMIT_EXCEEDED',
    );
  });
});

test.describe('invalid profile requests', { tag: '@mutates' }, () => {
  test('POST /profiles with an age band outside 0/7/12/16 answers 400', { tag: '@PRF-09' }, async ({ api, undo }) => {
    undo(noSuiteProfilesLeft(api));
    await expectError(await api.createProfile({ name: `${PREFIX}invalid`, age_band: 5 }), 'createProfile', 400);
  });

  test('POST /profiles without a name answers 400', { tag: '@PRF-10' }, async ({ api, undo }) => {
    // A nameless profile has no suite prefix, so noSuiteProfilesLeft can't find it:
    // it's deleted by the id from the response.
    let createdId: number | undefined;
    undo(async () => {
      if (createdId !== undefined) await expectResponse(await api.deleteProfile(createdId), 'deleteProfile', 204);
    });
    const res = await api.createProfile({ age_band: 0 });
    if (res.status() === 201) createdId = (await res.json()).id;
    await expectError(res, 'createProfile', 400);
  });

  test('PUT /profiles/current without profile_id answers 400 E_NEED_PARAM', { tag: '@PRF-11' }, async ({ api }) => {
    await expectError(await api.switchCurrentProfile({}), 'switchCurrentProfile', 400, 'E_NEED_PARAM');
  });

  test('PUT /profiles/current to a profile of another subscription answers 404', { tag: '@PRF-12' }, async ({ api, undo }) => {
    // Should the server allow switching to another subscriber's profile, it's
    // switched back before the next test.
    const main = (await listProfiles(api)).items.find((profile) => profile.is_main)!;
    undo(backToMainProfile(api, main.id));
    await expectError(await api.switchCurrentProfile({ profile_id: 1 }), 'switchCurrentProfile', 404);
  });
});
