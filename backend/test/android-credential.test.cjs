const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

for (const directory of ['public', 'themeparkinfo-mobile/www']) {
  function page(plugin) {
    const dom = new JSDOM('', { url: 'https://localhost', runScripts: 'outside-only' });
    const w = dom.window;
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { AlertCredential: plugin } };
    w.eval(fs.readFileSync(path.resolve(__dirname, '../..', directory, 'assets/js/alertSecurity.js'), 'utf8'));
    return dom;
  }

  test(`${directory}: Android migration preserves identity, serializes initialization, and clears secure storage after server deletion`, async () => {
    const legacy = 'a'.repeat(64), replacement = 'b'.repeat(64);
    let reads = 0, cleared = false;
    const dom = page({
      async getOrCreate(options) {
        reads++;
        assert.equal(options.legacyCredential, cleared ? null : legacy);
        return { credential: cleared ? replacement : legacy };
      },
      async clear() { cleared = true; }
    });
    const w = dom.window;
    try {
      w.localStorage.setItem('privateAlertCredentialV1', legacy);
      const requests = [];
      w.fetch = async (url, options) => { requests.push(options); return { ok: true }; };
      await Promise.all([w.AlertSecurity.request('/api/alerts'), w.AlertSecurity.request('/api/alerts')]);
      assert.equal(reads, 1);
      assert.equal(w.localStorage.getItem('privateAlertCredentialV1'), null);
      assert.ok(requests.every(options => options.headers.Authorization === 'Bearer ' + legacy));
      await w.AlertSecurity.deleteAll();
      assert.equal(cleared, true);
      await w.AlertSecurity.request('/api/alerts');
      assert.equal(requests.at(-1).headers.Authorization, 'Bearer ' + replacement);
      assert.equal(w.localStorage.getItem('privateAlertCredentialV1'), null);
    } finally { w.close(); }
  });

  test(`${directory}: Android storage failure retains migration source and sends no request; retry succeeds`, async () => {
    const legacy = 'c'.repeat(64);
    let failed = true, requests = 0;
    const dom = page({ async getOrCreate() {
      if (failed) throw new Error('Keystore unavailable');
      return { credential: legacy };
    } });
    const w = dom.window;
    try {
      w.localStorage.setItem('privateAlertCredentialV1', legacy);
      w.fetch = async () => { requests++; return { ok: true }; };
      await assert.rejects(w.AlertSecurity.request('/api/alerts'), /Keystore unavailable/);
      assert.equal(requests, 0);
      assert.equal(w.localStorage.getItem('privateAlertCredentialV1'), legacy);
      failed = false;
      await w.AlertSecurity.request('/api/alerts');
      assert.equal(requests, 1);
      assert.equal(w.localStorage.getItem('privateAlertCredentialV1'), null);
    } finally { w.close(); }
  });

  test(`${directory}: Android missing plugin cannot silently fall back to plaintext`, async () => {
    const dom = page(undefined), w = dom.window;
    try {
      w.fetch = () => { throw new Error('Must not fetch'); };
      await assert.rejects(w.AlertSecurity.request('/api/alerts'), /secure alert storage is unavailable/);
      assert.equal(w.localStorage.length, 0);
    } finally { w.close(); }
  });
}
