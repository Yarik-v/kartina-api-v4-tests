import { readFileSync } from 'node:fs';
import { test, expect, type Undo } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import type { V4ApiClient } from '../../src/client';
import { v4AdminCreatedAccount, v4Login, v4ProtectCode } from '../../src/config';
import { CHOICE_SETTINGS, type Account, type ApiError, type ClientSettings } from '../../src/types';
import { V4_SESSION_FILE } from '../session';

const NO_PROTECT_CODE = 'V4_PROTECT_CODE is not set in .env';

function sharedSessionId(): string | undefined {
  const state = JSON.parse(readFileSync(V4_SESSION_FILE, 'utf8')) as { cookies: { name: string; value: string }[] };
  return state.cookies.find((cookie) => cookie.name === 'MW_SSID')?.value;
}

test.describe('GET /account', () => {
  test('returns the logged-in client, its packet and this very session', { tag: '@CLI-01' }, async ({ api }) => {
    const body = await expectResponse<Account>(await api.getAccount(), 'getAccount', 200);

    expect(body.login).toBe(Number(v4Login));
    expect(body.security, 'the session id the request was made with').toBe(sharedSessionId());
    expect(body.services).toBe('/api/v4/services');
    expect(body.settings).toBe('/api/v4/settings');
    // Unlike the login body, the account carries the sharing link when the packet has one.
    expect([null, '/api/v4/sharing/link']).toContain(body.packet.share_links);
  });

  test('the registration prompt shows only without a personal cabinet', { tag: '@CLI-15' }, async ({ api }) => {
    // hasPersonalAccount: "The prompt is shown only when false."
    const body = await expectResponse<Account>(await api.getAccount(), 'getAccount', 200);
    if (body.registration_prompt.show) expect(body.has_personal_account, 'prompt shown, so no personal cabinet').toBe(false);
    if (body.has_personal_account !== false) expect(body.registration_prompt.show, 'a personal cabinet, so no prompt').toBe(false);
  });

  test('an account created in the admin panel has a personal cabinet and no prompt', { tag: '@CLI-16' }, async ({ api }) => {
    // The dev team's rule, not the spec's: admin-panel accounts always have a personal
    // cabinet. Until the staging deploy of 20.10.2026 this account answered false.
    test.skip(!v4AdminCreatedAccount, 'V4_ADMIN_CREATED_ACCOUNT is not set: the account may not come from the admin panel');
    const body = await expectResponse<Account>(await api.getAccount(), 'getAccount', 200);
    expect(body.has_personal_account).toBe(true);
    expect(body.registration_prompt.show).toBe(false);
  });
});

// Settings belong to the shared session's device (the suite's own serial), not the
// account, so they can't reach real devices. Every test, rejected changes included,
// registers the restore with `undo` before sending anything.
test.describe('client settings', { tag: '@mutates' }, () => {
  test.describe.configure({ mode: 'default' });

  async function readSettings(api: V4ApiClient): Promise<ClientSettings> {
    return expectResponse<ClientSettings>(await api.getSettings(), 'getSettings', 200);
  }

  /** Puts every setting back to `original`, `standard` first since it recalculates the others. */
  async function restore(api: V4ApiClient, original: ClientSettings): Promise<void> {
    let current = await readSettings(api);
    for (const name of CHOICE_SETTINGS) {
      if (current[name].value === original[name].value) continue;
      current = await expectResponse<ClientSettings>(await api.changeSetting(name, original[name].value), 'changeSetting', 200);
    }
    if (current.catchup.enabled !== original.catchup.enabled) {
      current = await expectResponse<ClientSettings>(await api.changeSetting('catchup', original.catchup.enabled), 'changeSetting', 200);
    }
    expect(current, 'settings restored').toEqual(original);
  }

  test('GET /settings: every choice holds one of its own allowed values', { tag: '@CLI-02' }, async ({ api }) => {
    const settings = await readSettings(api);
    for (const name of CHOICE_SETTINGS) {
      const allowed = settings[name].allowed.map((option) => option.value);
      expect(allowed.length, `${name}.allowed`).toBeGreaterThan(0);
      expect(allowed, `${name}.value`).toContain(settings[name].value);
    }
  });

  test('POST /settings changes one setting, answers with all of them, and the change sticks', { tag: '@CLI-03' }, async ({ api, undo }) => {
    const original = await readSettings(api);
    const target = original.server.allowed.find((option) => option.value !== original.server.value);
    test.skip(!target, 'The server setting allows only its current value');
    undo(() => restore(api, original));

    const changed = await expectResponse<ClientSettings>(await api.changeSetting('server', target!.value), 'changeSetting', 200);
    expect(changed.server.value).toBe(target!.value);
    expect(Object.keys(changed).sort()).toEqual([...CHOICE_SETTINGS, 'catchup'].sort());
    expect((await readSettings(api)).server.value, 'GET /settings after the change').toBe(target!.value);
  });

  test('POST /settings for standard returns the recalculated settings', { tag: '@CLI-04' }, async ({ api, undo }) => {
    const original = await readSettings(api);
    const target = original.standard.allowed.find((option) => option.value !== original.standard.value);
    test.skip(!target, 'The standard setting allows only its current value');
    undo(() => restore(api, original));

    const changed = await expectResponse<ClientSettings>(await api.changeSetting('standard', target!.value), 'changeSetting', 200);
    expect(changed.standard.value).toBe(target!.value);
    // "Re-render them from the response": the body must describe a consistent state.
    for (const name of CHOICE_SETTINGS) {
      expect(changed[name].allowed.map((option) => option.value), name).toContain(changed[name].value);
    }
  });

  test('POST /settings rejects a value outside the allowed list with 400', { tag: '@CLI-05' }, async ({ api, undo }) => {
    const before = await readSettings(api);
    undo(() => restore(api, before));
    await expectError(await api.changeSetting('server', 'playwright-no-such-server'), 'changeSetting', 400);
    expect((await readSettings(api)).server.value, 'nothing changed').toBe(before.server.value);
  });

  test('POST /settings rejects an unknown setting name with 400', { tag: '@CLI-06' }, async ({ api, undo }) => {
    const before = await readSettings(api);
    undo(() => restore(api, before));
    await expectError(await api.changeSettingRaw({ name: 'playwright', value: 1 }), 'changeSetting', 400);
  });

  test('POST /settings rejects a body without value with 400', { tag: '@CLI-07' }, async ({ api, undo }) => {
    const before = await readSettings(api);
    undo(() => restore(api, before));
    await expectError(await api.changeSettingRaw({ name: 'server' }), 'changeSetting', 400);
  });
});

/**
 * For a change request that must be rejected: registers, before it's sent, a check
 * that the protect code still works and, if the server changed it anyway, a restore
 * from each code the request could have set.
 */
function guardProtectCode(api: V4ApiClient, undo: Undo, possibleCodes: string[]): void {
  undo(async () => {
    const check = await api.checkProtectCode({ code: v4ProtectCode });
    if (check.status() === 200) return;
    // Restore only on a definite "wrong code": a transient error must not trigger
    // change attempts with guessed codes, so it fails the test for a person to check.
    const type = ((await check.json().catch(() => null)) as ApiError | null)?.error?.type;
    expect(`${check.status()} ${type}`, 'protect code check after the change request').toBe('403 E_CURRENT_PASS_BAD');
    for (const code of possibleCodes) {
      await api.raw('POST', 'protect-code/change', { data: { old: code, new: v4ProtectCode, confirm: v4ProtectCode } });
    }
    expect((await api.checkProtectCode({ code: v4ProtectCode })).status(), 'protect code restored').toBe(200);
  });
}

// The suite never changes the protect code, and without V4_PROTECT_CODE never sends
// one. Checks without a code or with the right one change nothing: read-only project.
test.describe('protect code check', () => {
  test('POST /protect-code/check without a code answers 400', { tag: '@CLI-09' }, async ({ api }) => {
    await expectError(await api.checkProtectCode({}), 'checkProtectCode', 400);
  });

  test('POST /protect-code/check accepts the right code', { tag: '@CLI-10' }, async ({ api }) => {
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    const body = await expectResponse<{ success: boolean }>(
      await api.checkProtectCode({ code: v4ProtectCode }),
      'checkProtectCode',
      200,
    );
    expect(body.success).toBe(true);
  });
});

// The wrong code runs in the mutating project, one test at a time and apart from the
// hidden-channel tests: should the server count wrong attempts towards a lockout,
// the suite sends just this one.
test.describe('protect code', { tag: '@mutates' }, () => {
  test('POST /protect-code/check rejects a wrong code with 403 E_CURRENT_PASS_BAD', { tag: '@CLI-11' }, async ({ api }) => {
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    await expectError(await api.checkProtectCode({ code: `${v4ProtectCode}0` }), 'checkProtectCode', 403, 'E_CURRENT_PASS_BAD');
  });

  test('POST /protect-code/change without parameters answers 400 and changes nothing', { tag: '@CLI-12' }, async ({ api, undo }) => {
    // Needs the code only to prove afterwards that it still works.
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    guardProtectCode(api, undo, ['']);
    await expectError(await api.raw('POST', 'protect-code/change', { data: {} }), 'changeProtectCode', 400);
  });

  test('POST /protect-code/change rejects a confirmation that differs from the new code', { tag: '@CLI-13' }, async ({ api, undo }) => {
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    const candidates = ['1234567', '7654321'];
    guardProtectCode(api, undo, candidates);
    const res = await api.raw('POST', 'protect-code/change', { data: { old: v4ProtectCode, new: candidates[0], confirm: candidates[1] } });
    await expectError(res, 'changeProtectCode', 400);
  });
});
