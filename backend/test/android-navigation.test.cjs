const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const bundle = fs.readFileSync(path.resolve(__dirname, '../../public/assets/js/auth.bundle.js'), 'utf8');
for (const scenario of ['recent', 'expired', 'other-user', 'unverified', 'malformed', 'future']) {
  test(`Android navigation: ${scenario} account check`, async () => {
    const dom = new JSDOM('<html class="auth-loading"><body></body></html>', {
      url: 'https://localhost/pages/wdw.html', runScripts: 'outside-only'
    });
    const w = dom.window;
    const calls = [], refreshes = [];
    try {
      Object.assign(w, { Headers, Request, Response, fetch: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ uid: 'user-one' }), { status: 200 });
      } });
      w.Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true,
        Plugins: { FirebaseAuthentication: {
          getCurrentUser: async () => ({ user: { uid: 'user-one', emailVerified: scenario !== 'unverified' } }),
          getIdToken: async ({ forceRefresh }) => { refreshes.push(forceRefresh); return { token: 'test-token' }; }
        } } };
      const saved = { uid: scenario === 'other-user' ? 'user-two' : 'user-one',
        checkedAt: Date.now() + (scenario === 'future' ? 60000 : scenario === 'expired' ? -360000 : -1000) };
      w.sessionStorage.setItem('scout-navigation-check', scenario === 'malformed' ? '{' : JSON.stringify(saved));
      w.eval(bundle);
      await w.AppAuth.ready;
      assert.equal(calls.some(url => url.endsWith('/api/auth/config')), false);
      assert.equal(calls.filter(url => url.endsWith('/api/auth/me')).length, scenario === 'recent' ? 0 : 1);
      assert.equal(w.document.documentElement.classList.contains('auth-loading'), false);
      assert.equal(w.localStorage.getItem('scout-active-user'), 'user-one');
      await w.fetch('https://themeparkinfo-api.onrender.com/api/wdw');
      assert.ok(refreshes.every(force => force === false));
      assert.ok(calls.includes('https://themeparkinfo-api.onrender.com/api/wdw'));
    } finally { w.close(); }
  });
}
