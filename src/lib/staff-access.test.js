import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStaffAccess } from './staff-access.js';

function client(data, error = null, signoutError = null) {
  const scopes = [];
  return { scopes, rpc: async () => ({ data, error }), auth: { signOut: async ({ scope }) => { scopes.push(scope); return { error: signoutError }; } } };
}
test('a disabled staff session is signed out on this device', async () => {
  const mock = client(false);
  assert.equal(await checkStaffAccess(mock), 'disabled');
  assert.deepEqual(mock.scopes, ['local']);
});
test('active staff and unavailable access checks keep the session', async () => {
  for (const [data, error, result] of [[true, null, 'active'], [null, new Error('offline'), 'unavailable'], [null, null, 'unavailable']]) {
    const mock = client(data, error);
    assert.equal(await checkStaffAccess(mock), result);
    assert.deepEqual(mock.scopes, []);
  }
});
test('a sign-out failure is reported instead of redirecting in a loop', async () => {
  const mock = client(false, null, new Error('logout failed'));
  assert.equal(await checkStaffAccess(mock), 'signout_failed');
});
