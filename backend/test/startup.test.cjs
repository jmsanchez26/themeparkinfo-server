const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { generateKeyPairSync } = require('node:crypto');

test('configured Firebase initialization uses the installed SDK and reuses the default app without sending requests', async () => {
  const { initializeFirebaseMessaging } = require('../server');
  const { getApps, deleteApp } = require('firebase-admin/app');
  const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'synthetic-security-test', client_email: 'test@synthetic-security-test.iam.gserviceaccount.com', private_key: privateKey
  });
  try {
    const messaging = initializeFirebaseMessaging();
    assert.equal(typeof messaging.send, 'function');
    assert.equal(initializeFirebaseMessaging(), messaging);
    assert.equal(getApps().length, 1);
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
    await Promise.all(getApps().map(deleteApp));
  }
});

test('npm start entry point starts without Firebase credentials or park keys', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'themepark-startup-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir, PORT: '0', USE_HOSTED_PARK_DATA: 'false',
      FIREBASE_SERVICE_ACCOUNT_JSON: '', DISNEYLAND_API: '', HOLLYWOOD_API: '', WDW_API: '', USORLANDO_API: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    child.kill();
    await stopped;
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code + ': ' + output)); });
    child.stderr.on('data', data => { output += data; });
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('Server running on port')) { clearTimeout(timer); resolve(); }
    });
  });
  assert.ok(!output.includes('Server failed to start'));
  assert.ok(output.includes('Push notifications disabled: missing FIREBASE_SERVICE_ACCOUNT_JSON'));
  const state = JSON.parse(await fs.readFile(path.join(dataDir, 'secure-alerts.json'), 'utf8'));
  assert.deepEqual(state.alerts, []);
});
