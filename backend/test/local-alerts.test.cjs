const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  test(`${base}: local alert cards fetch ride status, wait and park-local timestamps`, async () => {
    const dom = new JSDOM('<div id="alertsStatus"></div><div id="alertsList"></div>', {
      url: 'http://localhost:3000/pages/alerts.html', runScripts: 'outside-only'
    });
    const w = dom.window;
    try {
      w.document.addEventListener = () => {};
      for (const name of ['purify.min.js', 'safeHtml.js', 'alertRules.js']) w.eval(fs.readFileSync(path.resolve(__dirname, '../../', base, 'assets/js', name), 'utf8'));
      w.localStorage.setItem('waitTimeAlerts', JSON.stringify([{ id: 'local-1', name: 'Test Ride', park: 'disneyland', waitTime: 10 }]));
      let offline = false, wait = 25;
      w.fetch = async url => {
        assert.equal(url, '/api/disneyland');
        if (offline) throw new Error('offline');
        return { ok: true, json: async () => ({ lastUpdated: '2027-07-16T04:00:00Z', data: { liveData: [{
          id: 'ride-1', name: 'Test Ride', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: wait } }
        }] } }) };
      };
      let source = fs.readFileSync(path.resolve(__dirname, '../../', base, 'assets/js/alertsManager.js'), 'utf8');
      source = source.replace('  async function loadAlerts(', '  window.testLoadAlerts = loadAlerts;\n  async function loadAlerts(');
      w.eval(source);
      await w.testLoadAlerts();
      assert.equal(w.document.querySelector('.alert-chip.status').textContent, 'OPERATING');
      assert.match(w.document.getElementById('alertsList').textContent, /25 min/);
      assert.match(w.document.getElementById('alertsList').textContent, /9:00 PM PDT/);
      assert.equal(JSON.parse(w.localStorage.getItem('waitTimeAlerts'))[0].rideId, 'ride-1');
      wait = 5;
      await w.testLoadAlerts();
      assert.ok(JSON.parse(w.localStorage.getItem('waitTimeAlerts'))[0].triggeredAt);
      assert.ok(w.document.querySelector('.alert-manager-card.is-hit'));
      offline = true;
      await w.testLoadAlerts();
      assert.equal(w.document.querySelector('.alert-chip.status').textContent, 'Live data unavailable');
      assert.equal(JSON.parse(w.localStorage.getItem('waitTimeAlerts')).length, 1);
    } finally { w.close(); }
  });
}
