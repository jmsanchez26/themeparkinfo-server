const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
for (const base of ['public', 'themeparkinfo-mobile/www']) {
  test(`${base}: good-time option saves without minutes and repeats only for a new qualifying drop`, async () => {
    const dom = new JSDOM('<div class="waitTimeAlertModal"></div>', { url: 'http://localhost:3000/pages/disneyland.html', runScripts: 'outside-only' });
    const w = dom.window;
    try {
      w.document.addEventListener = () => {};
      w.waitTimeAlerts = [];
      w.alertVar = 'disneyland';
      const ride = { id: 'ride-1', name: 'Test Ride', status: 'OPERATING', waitTime: 50,
        forecast: [{ time: new Date(Date.now() + 3600000).toISOString(), waitTime: 65 }] };
      w.parks = { disneyland: { rides: [ride], shows: [], res: [] }, caliadv: { rides: [], shows: [], res: [] } };
      for (const name of ['purify.min.js', 'safeHtml.js', 'alertRules.js', 'alertbtn.js']) w.eval(fs.readFileSync(path.resolve(__dirname, '../../', base, 'assets/js', name), 'utf8'));
      w.openSetAlertModal(ride);
      const select = w.document.getElementById('alertMode');
      assert.equal(select.options.length, 2);
      select.value = 'good_time'; select.dispatchEvent(new w.Event('change'));
      assert.ok(w.document.getElementById('alertThresholdFields').hidden);
      assert.equal(w.document.getElementById('alertValue').value, '');
      await w.document.getElementById('saveAlertBtn').onclick();
      const saved = JSON.parse(w.localStorage.getItem('waitTimeAlerts'));
      assert.equal(saved[0].mode, 'good_time');
      assert.equal(saved[0].waitTime, null);
      assert.equal(saved[0].lastObservedWait, 50);
      let messages = 0;
      w.openTriggeredModal = () => { messages++; };
      w.checkAlerts('disneyland'); assert.equal(messages, 0);
      ride.waitTime = 40; w.checkAlerts('disneyland'); assert.equal(messages, 1);
      w.checkAlerts('disneyland'); assert.equal(messages, 1);
      ride.waitTime = 35; w.checkAlerts('disneyland'); assert.equal(messages, 2);
      ride.waitTime = 30; ride.forecast = []; w.checkAlerts('disneyland'); assert.equal(messages, 2);
    } finally { w.close(); }
  });
}
