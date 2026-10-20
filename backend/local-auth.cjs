const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const port = process.env.LOCAL_PORT || '3001';
if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RENDER_SERVICE_ID) throw new Error('Local authentication cannot run on a hosted server.');
const cli = require.resolve('firebase-tools/lib/bin/firebase.js');
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(child => child.kill()); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
function run(file, args, extra = {}) {
  const child = spawn(process.execPath, [file, ...args], { cwd: __dirname, stdio: 'inherit', env: { ...process.env, ...extra } });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
  return child;
}
async function available(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
(async () => {
  if (!await available(9099) || !await available(Number(port))) throw new Error('Local auth ports are already in use. Stop the previous local test session first.');
  run(cli, ['emulators:start', '--only', 'auth', '--project', 'demo-adventure-scout', '--config', path.resolve(__dirname, '../firebase.json')], { CI: 'true' });
  console.log('Starting the local Authentication Emulator. Initial startup may take a few minutes.');
  const deadline = Date.now() + 300000;
  while (!stopping) {
    try {
      const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-adventure-scout/config', { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('Authentication emulator did not start.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (stopping) return;
  run(path.resolve(__dirname, 'server.js'), [], { NODE_ENV: 'development', PORT: port,
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_SERVICE_ACCOUNT_JSON: '',
    DATA_DIR: path.resolve(__dirname, 'data/local-auth-test') });
  console.log(`Local test app: http://localhost:${port}/pages/login.html — choose Continue as test user.`);
})().catch(error => { console.error(error.message); stop(1); });
