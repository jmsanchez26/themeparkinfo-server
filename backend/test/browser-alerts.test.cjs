const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  function page() {
    const dom = new JSDOM('', { url: 'http://localhost:3000/', runScripts: 'outside-only' });
    const w = dom.window;
    w.document.addEventListener = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    for (const file of ['alertRules.js', 'browserAlerts.js']) w.eval(fs.readFileSync(path.resolve(__dirname, '../..', base, 'assets/js', file), 'utf8'));
    return dom;
  }
  test(`${base}: homepage popup handles threshold, safe text, dismissal, and no repeat on refresh`, async () => {
    const dom = page(), w = dom.window;
    try {
      const attack = '<img src=x onerror=alert(1)>';
      w.localStorage.setItem('waitTimeAlerts', JSON.stringify([{ name: attack, park: 'wdw', rideId: 'r', waitTime: 20 }]));
      let wait = 30, calls = 0;
      w.fetch = async url => {
        calls++; assert.equal(url, '/api/wdw');
        return { ok: true, json: async () => ({ data: { liveData: [{ id: 'r', name: attack,
          entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: wait } } }] } }) };
      };
      await w.BrowserAlerts.check();
      assert.equal(w.document.querySelector('dialog'), null);
      wait = 10;
      await Promise.all([w.BrowserAlerts.check(), w.BrowserAlerts.check()]);
      assert.equal(calls, 2);
      const dialog = w.document.querySelector('dialog');
      assert.equal(dialog.open, true);
      assert.ok(dialog.textContent.includes(attack));
      assert.equal(dialog.querySelector('img'), null);
      assert.match(dialog.textContent, /Now 10 min/);
      dialog.querySelector('button').click();
      await w.BrowserAlerts.check();
      assert.equal(dialog.open, false);
      assert.ok(JSON.parse(w.localStorage.getItem('waitTimeAlerts'))[0].triggeredAt);
    } finally { w.close(); }
  });
  test(`${base}: good-time popup repeats only after a new drop and ignores deleted alerts and offline data`, async () => {
    const dom = page(), w = dom.window;
    try {
      const alert = { name: 'Ride', park: 'hollywood', mode: 'good_time', lastObservedWait: 50 };
      w.localStorage.setItem('waitTimeAlerts', JSON.stringify([alert]));
      let wait = 40, offline = false, deleted = false;
      w.fetch = async () => {
        if (offline) throw new Error('offline');
        if (deleted) w.localStorage.removeItem('waitTimeAlerts');
        return { ok: true, json: async () => ({ data: { liveData: [{ id: 'r', name: 'Ride', entityType: 'ATTRACTION',
          status: 'OPERATING', waitTime: wait, forecast: [{ time: new Date(Date.now() + 3600000).toISOString(), waitTime: 60 }] }] } }) };
      };
      await w.BrowserAlerts.check();
      const dialog = w.document.querySelector('dialog');
      assert.equal(dialog.open, true);
      dialog.querySelector('button').click();
      await w.BrowserAlerts.check(); assert.equal(dialog.open, false);
      offline = true; await w.BrowserAlerts.check(); assert.equal(dialog.open, false);
      offline = false; wait = 30; await w.BrowserAlerts.check(); assert.equal(dialog.open, true);
      dialog.querySelector('button').click();
      deleted = true; wait = 20; await w.BrowserAlerts.check();
      assert.equal(dialog.open, false);
      assert.equal(JSON.parse(w.localStorage.getItem('waitTimeAlerts') || '[]').length, 0);
    } finally { w.close(); }
  });
  test(`${base}: alerts page displays a popup before its card refresh consumes the trigger`, async () => {
    const dom = page(), w = dom.window;
    try {
      for (const id of ['alertsStatus', 'alertsList']) {
        const element = w.document.createElement('div'); element.id = id; w.document.body.appendChild(element);
      }
      for (const file of ['purify.min.js', 'safeHtml.js']) w.eval(fs.readFileSync(path.resolve(__dirname, '../..', base, 'assets/js', file), 'utf8'));
      w.localStorage.setItem('waitTimeAlerts', JSON.stringify([{ id: 'saved', name: 'Ride', park: 'wdw', waitTime: 20 }]));
      w.fetch = async () => ({ ok: true, json: async () => ({ data: { liveData: [{ id: 'r', name: 'Ride',
        entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 10 } } }] } }) });
      const source = fs.readFileSync(path.resolve(__dirname, '../..', base, 'assets/js/alertsManager.js'), 'utf8')
        .replace('  async function loadAlerts(', '  window.testLoadAlerts = loadAlerts;\n  async function loadAlerts(');
      w.eval(source);
      await w.testLoadAlerts();
      assert.equal(w.document.querySelector('dialog').open, true);
      assert.ok(w.document.querySelector('.alert-manager-card.is-hit'));
      w.document.querySelector('dialog button').click();
      await w.testLoadAlerts();
      assert.equal(w.document.querySelector('dialog').open, false);
    } finally { w.close(); }
  });
}
