const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAccountAuth, settings } = require('../account-auth');

test('account gate rejects missing, malformed, expired, anonymous and unverified production identities', async () => {
  let claims;
  const app = express();
  createAccountAuth({ environment: { NODE_ENV: 'production' }, verifier: async token => {
    if (token === 'bad.bad.bad') throw new Error('Invalid signature');
    return claims;
  } }).register(app);
  app.get('/api/wdw', (req, res) => res.json({ user: req.account.uid }));
  await request(app).get('/api/wdw').expect(401);
  await request(app).get('/api/wdw').set('X-Firebase-ID-Token', 'a'.repeat(64)).expect(401);
  await request(app).get('/api/wdw').set('X-Firebase-ID-Token', 'bad.bad.bad').expect(401);
  claims = { uid: 'one', firebase: { sign_in_provider: 'anonymous' } };
  await request(app).get('/api/wdw').set('X-Firebase-ID-Token', 'test.test.test').expect(401);
  claims = { uid: 'one', email_verified: false, firebase: { sign_in_provider: 'password' } };
  await request(app).get('/api/wdw').set('X-Firebase-ID-Token', 'test.test.test').expect(403);
  claims.email_verified = true;
  const result = await request(app).get('/api/wdw').set('X-Firebase-ID-Token', 'test.test.test').expect(200);
  assert.equal(result.body.user, 'one');
  assert.equal(result.headers['cache-control'], 'no-store');
  const config = await request(app).get('/api/auth/config').expect(200);
  assert.equal(config.body.emulator, false);
  assert.equal(config.body.emulatorUrl, null);
  assert.deepEqual(Object.keys(config.body.firebase).sort(), ['apiKey', 'appId', 'authDomain', 'measurementId', 'messagingSenderId', 'projectId', 'storageBucket']);
  assert.equal(config.body.firebase.appId, '1:522688465989:web:18f973e215c496cfc4a72c');
  assert.deepEqual(config.body.firebase, require('../../themeparkinfo-mobile/www/assets/firebase-config.json'));
});

test('emulator mode is explicit, loopback-only and rejected on hosted servers', async () => {
  for (const environment of [
    { NODE_ENV: 'production' }, { RENDER: 'true' }, { RENDER_SERVICE_ID: 'test' }
  ]) assert.throws(() => settings({ ...environment, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }));
  assert.throws(() => settings({ FIREBASE_AUTH_EMULATOR_HOST: 'evil.invalid:9099' }));
  const app = express();
  createAccountAuth({ environment: { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    verifier: async () => ({ uid: 'demo', firebase: { sign_in_provider: 'anonymous' } }) }).register(app);
  await request(app).get('/api/auth/config').set('Host', 'evil.invalid').expect(403);
  const result = await request(app).get('/api/auth/me').set('Host', 'localhost').set('X-Firebase-ID-Token', 'demo.demo.demo').expect(200);
  assert.equal(result.body.uid, 'demo');
});
