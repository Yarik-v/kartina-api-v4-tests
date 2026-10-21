import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import type { Account } from '../../src/types';

// Only what can't change the account: reads, and requests the server must reject.
// Sending a verification code, creating friend credentials, revoking a friend and
// answering the registration prompt are real, outward or one-way actions, so the
// suite never makes them (they're still covered by the anonymous 403 sweep).

test.describe('Sharing (Mobile Friend)', () => {
  test('GET /sharing/link from a TV device answers 400: mobile devices only', { tag: '@SHR-01' }, async ({ api }) => {
    await expectError(await api.getSharingLink(), 'getSharingLink', 400);
  });

  test('GET /sharing/status answers one of its documented outcomes', { tag: '@SHR-02' }, async ({ api }) => {
    const res = await api.getSharingStatus();
    // 403 E_ACCESS_DENIED is the documented answer for an account that isn't a Mobile Friend.
    if (res.status() === 403) await expectError(res, 'getSharingStatus', 403, 'E_ACCESS_DENIED');
    else await expectResponse(res, 'getSharingStatus', 200);
  });

  test('GET /sharing/friends answers one of its documented outcomes', { tag: '@SHR-03' }, async ({ api }) => {
    const res = await api.getSharingFriends();
    if (res.status() === 503) await expectError(res, 'getSharingFriends', 503);
    else await expectResponse(res, 'getSharingFriends', 200);
  });

  test('POST /sharing/redeem without a code answers 400', { tag: ['@no-session', '@SHR-04', '@GEN-04'] }, async ({ anonApi }) => {
    await expectError(await anonApi.redeemSharingLink({}), 'redeemSharingLink', 400);
  });
});

test.describe('Registration prompt', () => {
  test('the account reports the prompt state', { tag: '@REG-01' }, async ({ account }) => {
    expect([1, 2]).toContain(account.registration_prompt.prompt_count);
  });

  test('POST /registration-prompt/dismiss with an unknown action answers 400 and leaves the prompt as it was', { tag: '@REG-02' }, async ({
    api,
    account,
  }) => {
    await expectError(
      await api.dismissRegistrationPrompt({ action: 'playwright' }),
      'dismissRegistrationPrompt',
      400,
    );
    const after = await expectResponse<Account>(await api.getAccount(), 'getAccount', 200);
    expect(after.registration_prompt).toEqual(account.registration_prompt);
  });

  test('POST /registration-prompt/dismiss without an action answers 400', { tag: '@REG-03' }, async ({ api }) => {
    await expectError(await api.dismissRegistrationPrompt({}), 'dismissRegistrationPrompt', 400);
  });
});
