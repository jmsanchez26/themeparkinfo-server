const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { webcrypto, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function page() {
  const dom = new JSDOM('', { url: 'https://localhost/pages/wdw.html', runScripts: 'outside-only' });
  Object.defineProperty(dom.window.crypto, 'subtle', { value: webcrypto.subtle });
  dom.window.TextEncoder = TextEncoder;
  dom.window.__API_BASE__ = 'https://themeparkinfo-api.onrender.com';
  return dom;
}
test('client creates a stable random credential and handles push proof arriving before HTTP response', async () => {
  const dom = page(), w = dom.window;
  try {
    const requests = [];
    const token = 'SYNTHETIC_CLIENT_TOKEN_1234567890';
    const proof = 'f'.repeat(64);
    let listener, removed = false, verified = false;
    const push = { async addListener(name, callback) { listener = callback; return { async remove() { removed = true; } }; } };
    w.fetch = async (url, options) => {
      requests.push({ url, options });
      assert.match(options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
      assert.ok(!url.includes(token));
      if (url.endsWith('/challenge')) {
        listener({ data: { source: 'device-verification', challengeId: 'challenge-1', proof } });
        return { ok: true, json: async () => ({ challengeId: 'challenge-1' }) };
      }
      if (url.endsWith('/verify')) {
        assert.deepEqual(JSON.parse(options.body), { challengeId: 'challenge-1', proof });
        verified = true;
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ verified, tokenHash: verified ? createHash('sha256').update(token).digest('hex') : null }) };
    };
    w.eval(fs.readFileSync(path.join(root, 'public/assets/js/alertSecurity.js'), 'utf8'));
    await w.AlertSecurity.verifyDevice(token, push);
    assert.ok(verified); assert.ok(removed);
    assert.equal(new Set(requests.map(r => r.options.headers.Authorization)).size, 1);
    await w.AlertSecurity.verifyDevice(token, push);
    assert.equal(requests.filter(r => r.url.endsWith('/challenge')).length, 1);
    await assert.rejects(w.AlertSecurity.request('/api/not-a-private-endpoint'));
  } finally { w.close(); }
});

test('push registration gets a fresh token and resolves without recursive initialization', async () => {
  const dom = page(), w = dom.window;
  try {
    const callbacks = new Map();
    const push = {
      async addListener(name, callback) {
        const list = callbacks.get(name) || []; list.push(callback); callbacks.set(name, list);
        return { async remove() { callbacks.set(name, (callbacks.get(name) || []).filter(item => item !== callback)); } };
      },
      async requestPermissions() { return { receive: 'granted' }; },
      async register() { for (const callback of callbacks.get('registration') || []) callback({ value: 'FRESH_TOKEN' }); }
    };
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { PushNotifications: push } };
    w.localStorage.setItem('pushDeviceToken', 'STALE_TOKEN');
    w.eval(fs.readFileSync(path.join(root, 'public/assets/js/alertbtn.js'), 'utf8'));
    assert.equal(await w.initializePushNotifications(), 'FRESH_TOKEN');
    assert.equal(w.localStorage.getItem('pushDeviceToken'), 'FRESH_TOKEN');
    assert.equal(callbacks.get('registration').length, 1); // only the persistent rotation listener remains
  } finally { w.close(); }
});
