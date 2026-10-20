const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  test(`${base}: login calls authentication, supports recovery and verification, and never saves passwords`, async () => {
    const root = path.resolve(__dirname, '../..', base);
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'pages/login.html'), 'utf8'), {
      url: 'http://localhost:3000/pages/login.html', runScripts: 'outside-only'
    });
    const w = dom.window, d = w.document;
    try {
      let google = 0, signup = 0;
      w.AppAuth = { ready: Promise.resolve(), emulator: true, user: null,
        async google() { google++; }, async email(email, password, create) {
          assert.equal(email, 'sample@example.com'); assert.equal(password, 'SAMPLE_ONLY_123');
          assert.equal(create, true); signup++; return { verificationRequired: true };
        }
      };
      w.eval(fs.readFileSync(path.join(root, 'assets/js/login.js'), 'utf8'));
      const settle = () => new Promise(resolve => setImmediate(resolve));
      await settle();
      assert.equal(d.getElementById('test-signin').hidden, false);
      assert.equal(d.getElementById('email-form').hidden, true);
      d.getElementById('google-signin').click();
      await settle(); assert.equal(google, 1);
      d.getElementById('email-signin').click();
      assert.equal(d.getElementById('email-form').hidden, false);
      d.getElementById('login-email').value = 'sample@example.com';
      d.getElementById('login-password').value = 'SAMPLE_ONLY_123';
      d.getElementById('show-password').click();
      assert.equal(d.getElementById('login-password').type, 'text');
      d.getElementById('switch-mode').click();
      assert.equal(d.getElementById('email-submit').textContent, 'Create account');
      assert.equal(d.getElementById('login-password').minLength, 8);
      const event = new w.Event('submit', { cancelable: true });
      d.getElementById('email-form').dispatchEvent(event);
      await settle();
      assert.equal(event.defaultPrevented, true);
      assert.equal(d.getElementById('login-password').value, '');
      assert.equal(signup, 1);
      assert.equal(d.getElementById('verification-actions').hidden, false);
      assert.equal(w.localStorage.length, 0);
      assert.equal(w.sessionStorage.length, 0);
      d.getElementById('switch-mode').click();
      d.getElementById('forgot-password').click();
      assert.equal(d.getElementById('password-fields').hidden, true);
      assert.equal(d.getElementById('login-password').required, false);
      assert.equal(d.getElementById('email-submit').textContent, 'Send reset link');
      d.getElementById('back-to-options').click();
      assert.equal(d.getElementById('email-form').hidden, true);
      assert.equal(d.getElementById('login-email').value, '');
      assert.equal(d.getElementById('login-password').type, 'password');
    } finally { w.close(); }
  });
}
