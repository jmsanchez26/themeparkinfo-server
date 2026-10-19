const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const rules = require('../../public/assets/js/alertRules');

function ride(wait, forecast = [60, 65], status = 'OPERATING') {
  return { id: 'ride-1', name: 'Test Ride', entityType: 'ATTRACTION', status,
    queue: { STANDBY: { waitTime: wait } },
    forecast: forecast.map((waitTime, index) => ({ waitTime, time: new Date(Date.now() + (index + 1) * 3600000).toISOString() })) };
}

test('good-time alerts require an actual drop, an operating ride, and usable good-time forecasts', () => {
  const alert = { mode: 'good_time', lastObservedWait: 50 };
  assert.equal(rules.evaluate(alert, ride(40)).isTriggered, true);
  assert.equal(rules.evaluate(alert, ride(50)).isTriggered, false);
  assert.equal(rules.evaluate(alert, ride(60)).isTriggered, false);
  assert.equal(rules.evaluate(alert, ride(40, [])).isTriggered, false);
  assert.equal(rules.evaluate(alert, ride(40, [5, 10])).isTriggered, false);
  assert.equal(rules.evaluate(alert, ride(40, [60], 'CLOSED')).isTriggered, false);
  assert.equal(rules.evaluate({ mode: 'good_time' }, ride(40)).isTriggered, false);
  assert.equal(rules.evaluate({ waitTime: 30 }, ride(25, [])).isTriggered, true);
  assert.equal(rules.evaluate({ waitTime: 30 }, ride(40, [])).isTriggered, false);
});

test('server sends once per qualifying decrease, stays quiet on unchanged waits, and requires a baseline after reopening', async t => {
  const server = require('../server');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'themepark-smart-alert-'));
  const originalFile = server.alertStore.file;
  server.alertStore.file = path.join(dir, 'alerts.json');
  await server.alertStore.load();
  const messages = [];
  server.pushState.messaging = { async send(message) { messages.push(message); } };
  t.after(async () => {
    server.alertStore.file = originalFile;
    server.pushState.messaging = null;
    await fs.rm(dir, { recursive: true, force: true });
  });
  await server.alertStore.transaction(state => {
    state.devices.push({ ownerHash: 'synthetic-owner', token: 'synthetic-token', expiresAt: Date.now() + 86400000 });
    state.alerts.push({ id: 'alert-1', ownerHash: 'synthetic-owner', deviceToken: 'synthetic-token', park: 'wdw',
      rideId: 'ride-1', name: 'Test Ride', mode: 'good_time', waitTime: null, lastObservedWait: 60, createdAt: new Date().toISOString() });
  });
  async function update(item) {
    server.cache.wdw.data = { liveData: [item] };
    await server.processTriggeredAlertsForPark('wdw');
  }
  await update(ride(50, [10, 20])); assert.equal(messages.length, 0);
  await update(ride(40)); assert.equal(messages.length, 1);
  assert.match(messages[0].notification.body, /dropped to 40 min.*good time to ride/);
  await update(ride(40)); assert.equal(messages.length, 1);
  await update(ride(35)); assert.equal(messages.length, 2);
  await update(ride(0, [], 'CLOSED')); assert.equal(messages.length, 2);
  await update(ride(20)); assert.equal(messages.length, 2);
  await update(ride(15)); assert.equal(messages.length, 3);
  const sender = server.pushState.messaging;
  server.pushState.messaging = { async send() { throw Object.assign(new Error('temporary failure'), { code: 'messaging/internal-error' }); } };
  await update(ride(10)); assert.equal(messages.length, 3);
  assert.equal(server.alertStore.state.alerts[0].lastObservedWait, 15);
  server.pushState.messaging = sender;
  await update(ride(10)); assert.equal(messages.length, 4);
  await update(ride(10)); assert.equal(messages.length, 4);
});
