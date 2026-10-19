const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  for (const platform of ['web', 'ios', 'android']) {
    test(`${base} ${platform}: saved favorites and alerts appear together without park-page globals`, async () => {
      const dom = new JSDOM('<div id="favoriteRidesList"></div><div id="savedAlertsList"></div>', {
        url: 'http://localhost:3000/', runScripts: 'outside-only'
      });
      const w = dom.window;
      try {
        if (platform !== 'web') w.Capacitor = { getPlatform: () => platform };
        const ride = { id: 'ride-1', name: 'Test Mountain', entityType: 'ATTRACTION',
          parkId: '75ea578a-adc8-4116-a54d-dccb60765ef9', status: 'OPERATING', queue: { STANDBY: { waitTime: 15 } } };
        w.localStorage.setItem('favoriteRideKeys', JSON.stringify(['mg::ride-1']));
        w.localStorage.setItem('waitTimeAlerts', JSON.stringify([{ id: 'alert-1', name: ride.name, park: 'wdw', waitTime: 25 }]));
        if (platform === 'android') w.localStorage.setItem('pushDeviceToken', 'synthetic-token');
        let privateReads = 0;
        w.AlertSecurity = { async request(url) {
          assert.equal(url, '/api/alerts'); privateReads++;
          return { ok: true, json: async () => ({ data: [{ id: 'alert-1', name: ride.name, park: 'wdw', waitTime: 25, currentWait: 15, status: 'OPERATING' }] }) };
        } };
        w.fetch = async url => ({ ok: true, json: async () => ({ data: { liveData: String(url).endsWith('/api/wdw') ? [ride] : [] } }) });
        for (const name of ['purify.min.js', 'safeHtml.js']) w.eval(fs.readFileSync(path.join(root, base, 'assets/js', name), 'utf8'));
        let load;
        w.document.addEventListener = (event, callback) => { if (event === 'DOMContentLoaded') load = callback; };
        const errors = [];
        w.console.error = (...args) => errors.push(args);
        w.eval(fs.readFileSync(path.join(root, base, 'assets/js/homepage.js'), 'utf8'));
        assert.equal(w.PARK_IDS, undefined);
        await load();
        assert.deepEqual(errors, []);
        assert.equal(w.document.querySelector('#favoriteRidesList h3').textContent, ride.name);
        assert.equal(w.document.querySelector('#savedAlertsList h3').textContent, ride.name);
        assert.equal(privateReads, platform === 'android' ? 1 : 0);
        // Another tab removes saved preferences; the homepage must refresh.
        if (platform !== 'android') {
          w.localStorage.setItem('waitTimeAlerts', '[]');
          w.localStorage.setItem('favoriteRideKeys', '[]');
          w.dispatchEvent(new w.StorageEvent('storage', { key: 'waitTimeAlerts' }));
          await new Promise(resolve => setTimeout(resolve, 20));
          assert.match(w.document.getElementById('favoriteRidesList').textContent, /No favorite rides/);
          assert.match(w.document.getElementById('savedAlertsList').textContent, /No saved alerts/);
        }
      } finally { w.close(); }
    });
  }
}
