const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  for (const platform of ['web', 'ios', 'android']) {
    test(`${base} ${platform}: ride badges follow saved alerts and disappear after deletion`, async () => {
      const dom = new JSDOM('<div id="rides"></div>', { url: 'http://localhost:3000/pages/wdw.html', runScripts: 'outside-only' });
      const w = dom.window;
      try {
        w.document.addEventListener = () => {};
        if (platform !== 'web') w.Capacitor = { getPlatform: () => platform };
        const ride = { id: 'ride-1', name: 'Test Ride', status: 'OPERATING', waitTime: 20, rideNow: null };
        w.parks = { mg: { rides: [ride, { ...ride, id: 'ride-2' }], shows: [], res: [] } };
        w.alertVar = 'wdw';
        let saved = [{ rideId: 'ride-1', name: ride.name, park: 'wdw', mode: 'good_time' }];
        w.localStorage.setItem('waitTimeAlerts', JSON.stringify(saved));
        w.AlertSecurity = { async request(url) {
          assert.equal(url, '/api/alerts');
          return { json: async () => ({ data: saved }) };
        } };
        for (const name of ['purify.min.js', 'safeHtml.js', 'waittimes.js']) {
          w.eval(fs.readFileSync(path.resolve(__dirname, '../../', base, 'assets/js', name), 'utf8'));
        }
        w.renderAll = () => w.renderCards('mg', 'rides', '#rides');
        await w.refreshRideAlertState(); w.renderAll();
        assert.equal(w.document.querySelectorAll('.ride-alert-badge').length, 1);
        assert.match(w.document.querySelector('.ride-alert-badge').textContent, /Alert set/);
        assert.equal(w.hasRideAlert('usHollywood', ride), false);
        saved = []; w.localStorage.setItem('waitTimeAlerts', '[]');
        await w.refreshRideAlertState(); w.renderAll();
        assert.equal(w.document.querySelector('.ride-alert-badge'), null);
        // A successful save updates the badge immediately, without waiting for the next poll.
        w.markRideAlertSet(ride);
        assert.equal(w.document.querySelectorAll('.ride-alert-badge').length, 1);
      } finally { w.close(); }
    });
  }
}
