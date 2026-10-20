import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import type { LoginBody } from '../../src/client';
import { v4AuxSerial, v4Device, v4Login, v4Password } from '../../src/config';
import type { Account } from '../../src/types';

// Every session here is opened on the aux serial, never the shared session's: a
// login ends the previous session of its serial. For the same reason the whole file
// runs in one worker, in order (mode 'default' below; 'serial' would also skip the
// rest after a failure). Each one logs out again, so the suite gives the account's
// session slot back. Wrong-credential cases use a login that can't exist rather than
// a wrong password for the real account, so the run can't trip a lockout.
const auxCredentials = (): LoginBody => ({ login: v4Login, password: v4Password, device: v4Device, serial: v4AuxSerial });
// Non-numeric on purpose: a long number can belong to some other real account
// (99999999999 answers "Wrong password", not "Incorrect login").
const NOT_A_LOGIN = 'not-a-login';

test.describe.configure({ mode: 'default' });

function sessionCookie(res: { headersArray(): { name: string; value: string }[] }): string | undefined {
  return res
    .headersArray()
    .find(({ name, value }) => name.toLowerCase() === 'set-cookie' && value.startsWith('MW_SSID='))?.value;
}

test.describe('POST /login with valid credentials', () => {
  test('opens a session: client, packet and session id, also set as the MW_SSID cookie', async ({ anonApi }) => {
    const res = await anonApi.login(auxCredentials());
    const body = await expectResponse<Account>(res, 'login', 200);

    expect(body.login).toBe(Number(v4Login));
    expect(body.expire_at * 1000, 'contract expiration is in the future').toBeGreaterThan(Date.now());
    expect(body.services).toBe('/api/v4/services');
    expect(body.settings).toBe('/api/v4/settings');
    expect(body.packet.share_links, 'always null in the login body, see GET /account').toBeNull();
    expect(sessionCookie(res)).toMatch(new RegExp(`^MW_SSID=${body.security};`));
    // Documented as an encrypted token, explicitly not the session id.
    expect(res.headers()['x-token']).toBeTruthy();
    expect(res.headers()['x-token']).not.toBe(body.security);

    await expectResponse(await anonApi.logout(), 'logout', 204);
  });

  test('the new session authorizes requests and GET /account reports it', async ({ anonApi }) => {
    const login = await expectResponse<Account>(await anonApi.login(auxCredentials()), 'login', 200);
    const account = await expectResponse<Account>(await anonApi.getAccount(), 'getAccount', 200);

    expect(account.security).toBe(login.security);
    expect(account.login).toBe(login.login);
    expect(account.packet.id).toBe(login.packet.id);

    await expectResponse(await anonApi.logout(), 'logout', 204);
  });

  test('accepts the optional push_token', async ({ anonApi }) => {
    const res = await anonApi.login({
      ...auxCredentials(),
      push_token: 'a3dda5212a608ed800b14e12d549b59177a9024da271b3330f11c34112f188ea',
    });
    await expectResponse(res, 'login', 200);
    await expectResponse(await anonApi.logout(), 'logout', 204);
  });

  test('a second login of the same device and serial ends the first session', async ({ newAnonApi }) => {
    // Not in the spec, but every client depends on it: one session per device.
    const first = await newAnonApi();
    const second = await newAnonApi();
    const firstLogin = await expectResponse<Account>(await first.login(auxCredentials()), 'login', 200);
    const secondLogin = await expectResponse<Account>(await second.login(auxCredentials()), 'login', 200);
    expect(secondLogin.security).not.toBe(firstLogin.security);

    await expectError(await first.getAccount(), 'getAccount', 403, 'E_AUTH_ERROR');
    await expectResponse(await second.getAccount(), 'getAccount', 200);

    await expectResponse(await second.logout(), 'logout', 204);
  });
});

test.describe('POST /logout', () => {
  test('ends the session and expires its cookie', async ({ anonApi }) => {
    await expectResponse(await anonApi.login(auxCredentials()), 'login', 200);

    const res = await anonApi.logout();
    await expectResponse(res, 'logout', 204);
    expect(sessionCookie(res)).toMatch(/^MW_SSID=deleted;.*Max-Age=0/);

    await expectError(await anonApi.getAccount(), 'getAccount', 403, 'E_AUTH_ERROR');
  });

  test('a session that was logged out stays logged out', async ({ anonApi, newAnonApi }) => {
    const login = await expectResponse<Account>(await anonApi.login(auxCredentials()), 'login', 200);
    await expectResponse(await anonApi.logout(), 'logout', 204);

    // Replaying the old session id by hand, as a client with a stale cookie would.
    const stale = await newAnonApi();
    const res = await stale.raw('GET', 'account', { headers: { Cookie: `MW_SSID=${login.security}` } });
    await expectError(res, 'getAccount', 403, 'E_AUTH_ERROR');
  });

  test('without a session answers 403 E_AUTH_ERROR', { tag: '@no-session' }, async ({ anonApi }) => {
    await expectError(await anonApi.logout(), 'logout', 403, 'E_AUTH_ERROR');
  });
});

test.describe('POST /login with invalid input', { tag: '@no-session' }, () => {
  test('an empty body names every missing field', async ({ anonApi }) => {
    const body = await expectError(await anonApi.loginRaw({}), 'login', 400, 'E_NEED_PARAM');
    for (const field of ['login', 'password', 'device', 'serial']) {
      expect(body.error.details.description).toContain(`${field}: This value should not be blank.`);
    }
  });

  for (const field of ['login', 'password', 'device', 'serial'] as const) {
    test(`a body without ${field} is rejected with 400 naming only ${field}`, async ({ anonApi }) => {
      const payload: Record<string, string> = { login: NOT_A_LOGIN, password: 'x', device: v4Device, serial: v4AuxSerial };
      delete payload[field];
      const body = await expectError(await anonApi.loginRaw(payload), 'login', 400, 'E_NEED_PARAM');
      expect(body.error.details.description).toBe(`${field}: This value should not be blank.`);
    });
  }

  test('an unknown device model is rejected with 400', async ({ anonApi }) => {
    const res = await anonApi.loginRaw({ login: NOT_A_LOGIN, password: 'x', device: 'playwright-no-such-model', serial: v4AuxSerial });
    const body = await expectError(res, 'login', 400, 'E_NEED_PARAM');
    expect(body.error.details.description).toBe('Device playwright-no-such-model not found.');
  });

  test('an unknown login is rejected with 403 E_INCORRECT_LOGIN and opens no session', async ({ anonApi }) => {
    const res = await anonApi.loginRaw({ login: NOT_A_LOGIN, password: 'x', device: v4Device, serial: v4AuxSerial });
    const body = await expectError(res, 'login', 403, 'E_INCORRECT_LOGIN');
    expect(body.error.details.description).toBe('Incorrect login');

    await expectError(await anonApi.getAccount(), 'getAccount', 403, 'E_AUTH_ERROR');
  });
});
