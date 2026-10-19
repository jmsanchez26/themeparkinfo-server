const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { AlertStore, RETENTION_MS } = require('../alert-store');
const { registerAlertApi } = require('../alert-api');
const { buildAlertSnapshot } = require('../server');

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const hash = value => createHash('sha256').update(value).digest('hex');
const tokenA = 'SYNTHETIC_TOKEN_DEVICE_A_1234567890';
const tokenB = 'SYNTHETIC_TOKEN_DEVICE_B_1234567890';
async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'themepark-security-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new AlertStore(path.join(dir, 'alerts.json'));
  await store.load();
  const sent = [];
  const app = express();
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '12kb' }));
  registerAlertApi(app, {
    store, cache: { wdw: { data: { liveData: [{ id: 'ride-1', name: 'Test Ride', entityType: 'ATTRACTION' }] } } },
    snapshot: buildAlertSnapshot, messaging: () => ({ async send(message) { sent.push(message); return options.sender?.send(message); } }),
    verificationLimits: options.verificationLimits
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.publicMessage || 'Request failed' }));
  const send = (method, url, identity = A) => request(app)[method](url).set('Authorization', 'Bearer ' + identity);
  async function verify(identity, token) {
    const challenge = await send('post', '/api/alert-devices/challenge', identity).send({ deviceToken: token }).expect(202);
    const message = sent.at(-1);
    assert.equal(challenge.body.proof, undefined);
    assert.equal(message.token, token);
    return { challengeId: challenge.body.challengeId, proof: message.data.proof };
  }
  async function register(identity, token) {
    const proof = await verify(identity, token);
    await send('post', '/api/alert-devices/verify', identity).send(proof).expect(200);
    return proof;
  }
  return { app, store, send, verify, register, sent };
}

test('private alerts reject missing credentials and isolate read/update/delete between two verified devices', async t => {
  const { app, store, send, register } = await setup(t);
  await request(app).get('/api/alerts').expect(401);
  await request(app).get('/api/alerts?deviceToken=' + tokenA).expect(401);
  await register(A, tokenA); await register(B, tokenB);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', waitTime: 20 }).expect(201);
  const mine = await send('get', '/api/alerts').expect(200);
  assert.equal(mine.headers['cache-control'], 'no-store');
  assert.equal(mine.body.data.length, 1);
  const id = mine.body.data[0].id;
  for (const key of ['deviceToken', 'ownerHash', 'token']) assert.equal(mine.body.data[0][key], undefined);
  const other = await send('get', '/api/alerts?deviceToken=' + tokenA, B).expect(200);
  assert.deepEqual(other.body.data, []);
  await send('patch', '/api/alerts/' + id, B).send({ waitTime: 10 }).expect(404);
  await send('delete', '/api/alerts/' + id, B).expect(404);
  await send('patch', '/api/alerts/' + id).send({ waitTime: 10 }).expect(200);
  await send('delete', '/api/alerts/' + id).expect(200);
  assert.equal(store.state.alerts.length, 0);
});

test('knowing a push token cannot register it: proof is owner-bound, single-use, and required', async t => {
  const { send, verify, register, store } = await setup(t);
  const proof = await verify(A, tokenA);
  await send('post', '/api/alert-devices/verify', B).send(proof).expect(403);
  await send('post', '/api/alert-devices/verify').send({ ...proof, proof: '0'.repeat(64) }).expect(403);
  await send('post', '/api/alerts', B).send({ park: 'wdw', rideId: 'ride-1', waitTime: 10, deviceToken: tokenA }).expect(403);
  await send('post', '/api/alert-devices/verify').send(proof).expect(200);
  await send('post', '/api/alert-devices/verify').send(proof).expect(403);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', waitTime: 10 }).expect(201);
  await register(A, tokenB);
  assert.equal(store.state.alerts[0].deviceToken, tokenB);
  await send('delete', '/api/alert-devices').expect(200);
  assert.equal(store.state.devices.length, 0);
  assert.equal(store.state.alerts.length, 0);
});

test('validation rejects arbitrary HTML/unknown rides, excessive thresholds, objects and oversized bodies', async t => {
  const { app, send, register, store } = await setup(t);
  await register(A, tokenA);
  await send('post', '/api/alerts').send({ park: 'wdw', name: '<img src=x onerror=alert(1)>', deviceToken: tokenA, waitTime: 10 }).expect(400);
  for (const waitTime of [-1, 301, '20', 0.5, {}, null]) {
    await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', waitTime }).expect(400);
  }
  await send('post', '/api/alerts').send({ park: '__proto__', rideId: 'ride-1', waitTime: 10 }).expect(400);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'fake', waitTime: 10 }).expect(400);
  await request(app).post('/api/alerts').send({ data: 'x'.repeat(14000) }).expect(413);
  assert.equal(store.state.alerts.length, 0);
});

test('requests are rate limited', async t => {
  const { send } = await setup(t);
  for (let i = 0; i < 120; i++) await send('get', '/api/alerts').expect(200);
  await send('get', '/api/alerts').expect(429);
});

test('verified owners can create and edit good-time alerts without minutes while invalid modes remain rejected', async t => {
  const { send, register, store } = await setup(t);
  await register(A, tokenA);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', mode: 'good_time' }).expect(201);
  const alert = store.state.alerts[0];
  assert.equal(alert.mode, 'good_time');
  assert.equal(alert.waitTime, null);
  const response = await send('get', '/api/alerts').expect(200);
  assert.equal(response.body.data[0].mode, 'good_time');
  assert.equal(response.body.data[0].deviceToken, undefined);
  await send('patch', '/api/alerts/' + alert.id).send({ mode: 'threshold' }).expect(400);
  await send('patch', '/api/alerts/' + alert.id).send({ mode: 'threshold', waitTime: 25 }).expect(200);
  assert.equal(store.state.alerts[0].mode, 'threshold');
  assert.equal(store.state.alerts[0].waitTime, 25);
  await send('patch', '/api/alerts/' + alert.id).send({ mode: 'good_time' }).expect(200);
  await send('patch', '/api/alerts/' + alert.id).send({ mode: 'anything' }).expect(400);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', mode: 'anything', waitTime: 20 }).expect(400);
});

test('atomic persistence serializes concurrent updates, expires private data and rolls back write errors', async t => {
  const { store } = await setup(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.transaction(state => {
    state.devices.push({ ownerHash: hash(String(i)), token: 'synthetic' + i, expiresAt: Date.now() + RETENTION_MS });
  })));
  assert.equal(store.state.devices.length, 20);
  assert.equal(JSON.parse(await fs.readFile(store.file)).devices.length, 20);
  await store.transaction(state => { state.devices[0].expiresAt = Date.now() - 1; });
  await store.transaction(() => {});
  assert.equal(store.state.devices.length, 19);
  const originalFile = store.file;
  store.file = path.join(originalFile, 'not-a-directory');
  await assert.rejects(store.transaction(state => { state.devices = []; }));
  assert.equal(store.state.devices.length, 19);
  store.file = originalFile;
  await store.transaction(() => {});
  const fresh = new AlertStore(originalFile); await fresh.load();
  assert.equal(fresh.state.devices.length, 19);
  await fs.writeFile(originalFile, 'corrupt');
  await assert.rejects(new AlertStore(originalFile).load());
});

test('actual application emits CSP/security headers and blocks foreign CORS origins', async () => {
  const { app } = require('../server');
  const res = await request(app).get('/test').set('Origin', 'https://evil.invalid').expect(200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.ok(res.headers['content-security-policy'].includes("script-src 'self'"));
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  await request(app).get('/api/alerts').expect(401);
  const native = await request(app).options('/api/alerts').set('Origin', 'https://localhost').set('Access-Control-Request-Method', 'POST').expect(204);
  assert.equal(native.headers['access-control-allow-origin'], 'https://localhost');
});

test('unknown-owner mutations and unchanged transactions do not write to disk', async t => {
  const { send, store } = await setup(t);
  const originalFile = store.file;
  const before = await fs.readFile(originalFile, 'utf8');
  // Any attempted write here would fail. Unregistered deletion must still be idempotent.
  store.file = path.join(originalFile, 'not-a-directory');
  await send('delete', '/api/alert-devices').expect(200);
  await send('delete', '/api/alert-devices').expect(200);
  await send('post', '/api/alerts').send({ park: 'wdw', rideId: 'ride-1', waitTime: 10 }).expect(403);
  await send('patch', '/api/alerts/not-owned').send({ waitTime: 10 }).expect(404);
  await send('delete', '/api/alerts/not-owned').expect(404);
  await store.transaction(() => {});
  assert.equal(await fs.readFile(originalFile, 'utf8'), before);
  assert.equal(store.state.devices.length, 0);
});

test('delete-all queue guard observes earlier registrations, and owner writes are separately limited', async t => {
  const { store, send, register } = await setup(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const registration = store.transaction(async state => {
    await gate;
    state.devices.push({ ownerHash: hash(A), token: tokenA, expiresAt: Date.now() + RETENTION_MS });
  });
  const deletion = store.transaction(state => { state.devices = []; }, { when: state => state.devices.length > 0 });
  release(); await Promise.all([registration, deletion]);
  assert.equal(store.state.devices.length, 0);
  await register(A, tokenA); // one verify mutation
  for (let i = 0; i < 29; i++) await send('delete', '/api/alert-devices').expect(200);
  await send('delete', '/api/alert-devices').expect(429);
  await send('get', '/api/alerts').expect(200);
});

test('invalid verification requests do not consume valid-device challenge allowances', async t => {
  const { send, sent } = await setup(t);
  for (let i = 0; i < 8; i++) await send('post', '/api/alert-devices/challenge').send({ deviceToken: 'invalid' }).expect(400);
  assert.equal(sent.length, 0);
  await send('post', '/api/alert-devices/challenge').send({ deviceToken: tokenA }).expect(202);
  assert.equal(sent.length, 1);
});

test('token spam and a full anonymous queue do not consume registered-device verification capacity', async t => {
  const { send, register, sent } = await setup(t, { trustProxy: true, verificationLimits: { anonymousPending: 3, registeredPending: 1 } });
  await register(A, tokenA);
  for (let i = 0; i < 3; i++) {
    await send('post', '/api/alert-devices/challenge', hash('anonymous-' + i))
      .set('X-Forwarded-For', `192.0.2.${i + 1}`).send({ deviceToken: tokenB }).expect(202);
  }
  // The same token is bounded across unrelated unverified callers.
  await send('post', '/api/alert-devices/challenge', hash('fourth-caller'))
    .set('X-Forwarded-For', '192.0.2.4').send({ deviceToken: tokenB }).expect(429);
  // New tokens cannot bypass the anonymous pending-queue cap either.
  await send('post', '/api/alert-devices/challenge', hash('fifth-caller'))
    .set('X-Forwarded-For', '192.0.2.5').send({ deviceToken: 'ANOTHER_SYNTHETIC_TOKEN_1234567890' }).expect(429);
  const before = sent.length;
  await send('post', '/api/alert-devices/challenge', A).send({ deviceToken: tokenB }).expect(202);
  assert.equal(sent.length, before + 1);
});

test('slow anonymous push sends cannot occupy reserved registered-device send slots', async t => {
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const { send, register } = await setup(t, {
    trustProxy: true, verificationLimits: { anonymousSends: 1, registeredSends: 1 },
    sender: { async send(message) { if (message.token === tokenB) { entered(); await blocked; } } }
  });
  await register(A, tokenA);
  const waiting = send('post', '/api/alert-devices/challenge', B).set('X-Forwarded-For', '192.0.2.1').send({ deviceToken: tokenB }).then(response => response);
  try {
    await started;
    await send('post', '/api/alert-devices/challenge', hash('another-owner')).set('X-Forwarded-For', '192.0.2.2')
      .send({ deviceToken: 'ANOTHER_SYNTHETIC_TOKEN_1234567890' }).expect(429);
    await send('post', '/api/alert-devices/challenge', A).send({ deviceToken: tokenA }).expect(202);
  } finally {
    release();
    assert.equal((await waiting).status, 202);
  }
});

test('public park API limits are shared across park paths and isolated between client IPs', async () => {
  const { createPublicApiLimiter } = require('../api-limits');
  const app = express();
  app.set('trust proxy', 1); // explicit trusted test proxy; production defaults to no proxy trust
  app.get('/api/:park', createPublicApiLimiter(), (req, res) => res.json({ data: { liveData: [] } }));
  for (let i = 0; i < 180; i++) {
    await request(app).get(i % 2 ? '/api/wdw' : '/api/hollywood').set('X-Forwarded-For', '192.0.2.1').expect(200);
  }
  const limited = await request(app).get('/api/disneyland').set('X-Forwarded-For', '192.0.2.1').expect(429);
  assert.ok(limited.headers['retry-after']);
  assert.equal(limited.headers['cache-control'], 'no-store');
  assert.equal(limited.body.error, true);
  await request(app).get('/api/wdw').set('X-Forwarded-For', '192.0.2.2').expect(200);
});
