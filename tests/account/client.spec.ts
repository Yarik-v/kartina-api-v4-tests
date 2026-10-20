import { readFileSync } from 'node:fs';
import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import type { V4ApiClient } from '../../src/client';
import { v4Login, v4ProtectCode } from '../../src/config';
import { CHOICE_SETTINGS, type Account, type ClientSettings } from '../../src/types';
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
});

// Settings belong to the device of the shared session (the suite's own serial), not
// to the account, so changing them can't reach the account's real devices. Each
// test restores what it changed; the file runs in order so they never overlap.
test.describe('client settings', () => {
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

  test('POST /settings changes one setting, answers with all of them, and the change sticks', { tag: '@CLI-03' }, async ({ api }) => {
    const original = await readSettings(api);
    const target = original.server.allowed.find((option) => option.value !== original.server.value);
    test.skip(!target, 'The server setting allows only its current value');

    try {
      const changed = await expectResponse<ClientSettings>(await api.changeSetting('server', target!.value), 'changeSetting', 200);
      expect(changed.server.value).toBe(target!.value);
      expect(Object.keys(changed).sort()).toEqual([...CHOICE_SETTINGS, 'catchup'].sort());
      expect((await readSettings(api)).server.value, 'GET /settings after the change').toBe(target!.value);
    } finally {
      await restore(api, original);
    }
  });

  test('POST /settings for standard returns the recalculated settings', { tag: '@CLI-04' }, async ({ api }) => {
    const original = await readSettings(api);
    const target = original.standard.allowed.find((option) => option.value !== original.standard.value);
    test.skip(!target, 'The standard setting allows only its current value');

    try {
      const changed = await expectResponse<ClientSettings>(await api.changeSetting('standard', target!.value), 'changeSetting', 200);
      expect(changed.standard.value).toBe(target!.value);
      // "Re-render them from the response": the body must describe a consistent state.
      for (const name of CHOICE_SETTINGS) {
        expect(changed[name].allowed.map((option) => option.value), name).toContain(changed[name].value);
      }
    } finally {
      await restore(api, original);
    }
  });

  test('POST /settings rejects a value outside the allowed list with 400', { tag: '@CLI-05' }, async ({ api }) => {
    const before = await readSettings(api);
    await expectError(await api.changeSetting('server', 'playwright-no-such-server'), 'changeSetting', 400);
    expect((await readSettings(api)).server.value, 'nothing changed').toBe(before.server.value);
  });

  test('POST /settings rejects an unknown setting name with 400', { tag: '@CLI-06' }, async ({ api }) => {
    await expectError(await api.changeSettingRaw({ name: 'playwright', value: 1 }), 'changeSetting', 400);
  });

  test('POST /settings rejects a body without value with 400', { tag: '@CLI-07' }, async ({ api }) => {
    await expectError(await api.changeSettingRaw({ name: 'server' }), 'changeSetting', 400);
  });
});

// The protect (parental) code is never changed by the suite, and without
// V4_PROTECT_CODE it never sends a code at all, wrong or right.
test.describe('protect code', () => {
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

  test('POST /protect-code/check rejects a wrong code with 403 E_CURRENT_PASS_BAD', { tag: '@CLI-11' }, async ({ api }) => {
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    await expectError(await api.checkProtectCode({ code: `${v4ProtectCode}0` }), 'checkProtectCode', 403, 'E_CURRENT_PASS_BAD');
  });

  test('POST /protect-code/change without parameters answers 400 and changes nothing', { tag: '@CLI-12' }, async ({ api }) => {
    await expectError(await api.raw('POST', 'protect-code/change', { data: {} }), 'changeProtectCode', 400);
  });

  test('POST /protect-code/change rejects a confirmation that differs from the new code', { tag: '@CLI-13' }, async ({ api }) => {
    test.skip(!v4ProtectCode, NO_PROTECT_CODE);
    const candidates = ['1234567', '7654321'];
    const res = await api.raw('POST', 'protect-code/change', { data: { old: v4ProtectCode, new: candidates[0], confirm: candidates[1] } });
    try {
      await expectError(res, 'changeProtectCode', 400);
    } finally {
      // Should the server change the code anyway, put the original back before failing.
      if ((await api.checkProtectCode({ code: v4ProtectCode })).status() !== 200) {
        for (const code of candidates) {
          await api.raw('POST', 'protect-code/change', { data: { old: code, new: v4ProtectCode, confirm: v4ProtectCode } });
        }
        expect((await api.checkProtectCode({ code: v4ProtectCode })).status(), 'protect code restored').toBe(200);
      }
    }
  });
});
