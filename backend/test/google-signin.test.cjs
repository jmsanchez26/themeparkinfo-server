const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signInWithGoogle } = require('../../themeparkinfo-mobile/google-signin.cjs');

test('Google uses Credential Manager normally and returns the signed-in result', async () => {
  let calls = 0;
  const result = { user: { uid: 'test' } };
  assert.equal(await signInWithGoogle({ async signInWithGoogle(options) {
    calls++; assert.equal(options, undefined); return result;
  } }), result);
  assert.equal(calls, 1);
});

test('unsupported Credential Manager falls back once to the Google Play Services account picker', async () => {
  for (const message of ["Your device doesn't support credential manager", 'Your phone does not support Credential Manager', 'CredentialManager is unavailable']) {
    const calls = [], result = { user: { uid: 'test' } };
    assert.equal(await signInWithGoogle({ async signInWithGoogle(options) {
      calls.push(options);
      if (!options) throw new Error(message);
      return result;
    } }), result);
    assert.deepEqual(calls, [undefined, { useCredentialManager: false }]);
  }
});

test('Google cancellations and configuration errors are not retried; fallback failures propagate', async () => {
  for (const message of ['Credential Manager sign-in cancelled', 'DEVELOPER_ERROR', 'Network unavailable']) {
    let calls = 0;
    const error = new Error(message);
    await assert.rejects(signInWithGoogle({ async signInWithGoogle() { calls++; throw error; } }), candidate => candidate === error);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(signInWithGoogle({ async signInWithGoogle(options) {
    calls++;
    throw new Error(options ? 'Fallback error' : 'Credential Manager not supported');
  } }), /Fallback error/);
  assert.equal(calls, 2);
});
