const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  test(`${base}: public snapshots expire and exclude private or foreign endpoints`, () => {
    const dom = new JSDOM('', { url: 'https://localhost/pages/wdw.html', runScripts: 'outside-only' });
    const w = dom.window;
    try {
      w.eval(fs.readFileSync(path.join(root, base, 'assets/js/apiBase.js'), 'utf8'));
      const payload = { data: { liveData: [] } };
      for (const url of ['/api/alerts', '/api/auth/me', 'https://evil.invalid/api/wdw']) {
        w.ParkDataCache.write(url, payload);
        assert.equal(w.ParkDataCache.read(url), null);
      }
      w.ParkDataCache.write('/api/usOrlando', payload);
      assert.equal(JSON.stringify(w.ParkDataCache.read('/api/usorlando').payload), JSON.stringify(payload));
      const key = 'scout-park-snapshot:/api/usorlando';
      w.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 600001, payload }));
      assert.equal(w.ParkDataCache.read('/api/usorlando'), null);
      w.sessionStorage.setItem(key, '{');
      assert.equal(w.ParkDataCache.read('/api/usorlando'), null);
    } finally { w.close(); }
  });

  test(`${base}: saved rides render before live fetch and alert badges do not block live rides`, async () => {
    const dom = new JSDOM('<div id="header-placeholder"></div>', { url: 'https://localhost/pages/wdw.html', runScripts: 'outside-only' });
    const w = dom.window;
    try {
      const listeners = {};
      w.document.addEventListener = (name, handler) => { listeners[name] = handler; };
      w.setInterval = () => 0;
      w.setTimeout = () => 0;
      w.getParkHours = () => {};
      w.checkAlerts = () => {};
      w.Capacitor = { getPlatform: () => 'android' };
      w.AlertSecurity = { request: () => new Promise(() => {}) };
      w.__API_BASE__ = '';
      const setup = fs.readFileSync(path.join(root, base, 'assets/js/wdw-initial-setup.js'), 'utf8');
      const payload = { data: { liveData: [] } };
      let finish;
      w.fetch = () => new Promise(resolve => { finish = resolve; });
      w.ParkDataCache = { read: () => ({ savedAt: Date.now(), payload }), write: () => {} };
      w.eval(setup + '\n' + fs.readFileSync(path.join(root, base, 'assets/js/waittimes.js'), 'utf8') + '\nrenderAll = function () { window.renders = (window.renders || 0) + 1; };');
      listeners.DOMContentLoaded();
      assert.equal(w.renders, 1);
      assert.match(w.document.getElementById('park-data-status').textContent, /Saved.*Refreshing/);
      finish({ ok: true, json: async () => payload });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(w.renders, 2);
      assert.match(w.document.getElementById('park-data-status').textContent, /Wait times updated/);
    } finally { w.close(); }
  });
}
