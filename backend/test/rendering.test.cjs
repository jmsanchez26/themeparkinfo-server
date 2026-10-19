const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');

for (const base of ['public', 'themeparkinfo-mobile/www']) {
  test(`${base}: malicious stored alert HTML cannot retain executable content`, () => {
    const dom = new JSDOM('<div id="alertsList"></div>', { url: 'https://localhost/pages/alerts.html', runScripts: 'outside-only' });
    try {
      for (const name of ['purify.min.js', 'safeHtml.js']) dom.window.eval(fs.readFileSync(path.join(root, base, 'assets/js', name), 'utf8'));
      dom.window.AlertSecurity = { request: async () => ({ json: async () => ({ data: [] }) }) };
      dom.window.Capacitor = { getPlatform: () => 'android' };
      let source = fs.readFileSync(path.join(root, base, 'assets/js/alertsManager.js'), 'utf8');
      source = source.replace('  function renderAlerts(alerts) {', '  window.auditRender = renderAlerts;\n  function renderAlerts(alerts) {');
      // Avoid background polling in a rendering-only fixture.
      dom.window.document.addEventListener = () => {};
      dom.window.eval(source);
      const attack = '<img src=x onerror="window.compromised=1"><svg onload="window.compromised=1"></svg><a href="javascript:alert(1)">click</a><iframe srcdoc="<script>alert(1)</script>"></iframe>';
      dom.window.auditRender([{ id: 'test', name: attack, park: 'wdw', waitTime: 20, status: 'Operating' }]);
      const list = dom.window.document.getElementById('alertsList');
      assert.equal(list.querySelector('[onerror], [onload], [srcdoc], script, svg'), null);
      assert.equal(list.querySelector('a')?.getAttribute('href') ?? null, null);
      assert.equal(list.querySelector('h3').textContent, attack);
      assert.equal(dom.window.compromised, undefined);
      const safe = dom.window.SafeHTML.sanitize('<iframe src="https://evil.invalid/"></iframe><a href="/_capacitor_http_interceptor_?u=x">x</a>');
      assert.ok(!safe.includes('src="https://evil.invalid'));
      assert.ok(!safe.includes('href='));
      const map = dom.window.SafeHTML.sanitize('<iframe src="https://www.google.com/maps?q=Test&amp;output=embed"></iframe>');
      assert.ok(map.includes('https://www.google.com/maps'));
      assert.ok(map.includes('referrerpolicy="no-referrer"'));
    } finally { dom.window.close(); }
  });
}

test('all dynamic HTML assignments use the sanitizer; each page loads it before application scripts', () => {
  const acorn = require('acorn'), walk = require('acorn-walk');
  for (const base of ['public', 'themeparkinfo-mobile/www']) {
    const dir = path.join(root, base, 'assets/js');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && !['purify.min.js', 'safeHtml.js'].includes(f))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      walk.simple(acorn.parse(source, { ecmaVersion: 'latest' }), { AssignmentExpression(node) {
        if (node.left.type === 'MemberExpression' && node.left.property.name === 'innerHTML') {
          assert.ok(source.slice(node.right.start, node.right.end).startsWith('window.SafeHTML.sanitize('), file);
        }
      } });
    }
    const pages = [path.join(root, base, 'index.html'), ...fs.readdirSync(path.join(root, base, 'pages')).map(f => path.join(root, base, 'pages', f))];
    for (const file of pages.filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(html.indexOf('purify.min.js') < html.indexOf('safeHtml.js'), file);
      assert.ok(html.indexOf('safeHtml.js') < html.indexOf('apiBase.js'), file);
      assert.ok(html.includes('Content-Security-Policy'), file);
    }
  }
});
