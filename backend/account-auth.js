const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { rateLimit } = require('express-rate-limit');
const clientConfig = require('../public/assets/firebase-config.json');

function settings(environment = process.env) {
  const hosted = environment.NODE_ENV === 'production' || environment.RENDER === 'true' || Boolean(environment.RENDER_SERVICE_ID);
  const emulator = environment.FIREBASE_AUTH_EMULATOR_HOST || '';
  if (emulator && (hosted || emulator !== '127.0.0.1:9099')) throw new Error('Authentication emulator is allowed only in local development at 127.0.0.1:9099');
  return { emulator: Boolean(emulator), projectId: emulator ? 'demo-adventure-scout' : clientConfig.projectId };
}
function loopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.get('host') || '');
}
function createAccountAuth({ environment = process.env, verifier } = {}) {
  const config = settings(environment);
  let admin;
  function auth() {
    if (!admin) {
      const options = { projectId: config.projectId };
      if (environment.FIREBASE_SERVICE_ACCOUNT_JSON && !config.emulator) {
        const raw = JSON.parse(environment.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (raw.project_id !== config.projectId) throw new Error('Firebase account project does not match app configuration');
        options.credential = cert(raw);
      }
      const app = getApps().find(app => app.name === 'account-auth') || initializeApp(options, 'account-auth');
      admin = getAuth(app);
    }
    return admin;
  }
  const limiter = rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });
  async function requireUser(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (config.emulator && !loopback(req)) return res.status(403).json({ message: 'Local testing is available only on this computer.' });
    const token = req.get('X-Firebase-ID-Token');
    if (typeof token !== 'string' || token.length > 16000 || token.split('.').length !== 3) return res.status(401).json({ message: 'Please sign in to continue.' });
    try {
      const decoded = await (verifier ? verifier(token) : auth().verifyIdToken(token, true));
      if (!decoded.uid || (!config.emulator && decoded.firebase?.sign_in_provider === 'anonymous')) throw new Error('Unsupported account');
      if (!config.emulator && decoded.firebase?.sign_in_provider === 'password' && !decoded.email_verified) {
        return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email address before continuing.' });
      }
      req.account = { uid: decoded.uid, email: decoded.email || null };
      next();
    } catch {
      res.status(401).json({ message: 'Your sign-in expired. Please sign in again.' });
    }
  }
  function register(app) {
    app.get('/api/auth/config', (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (config.emulator && !loopback(req)) return res.status(403).json({ message: 'Local testing is available only on this computer.' });
      res.json({ firebase: config.emulator ? { apiKey: 'demo-key', projectId: config.projectId, authDomain: 'localhost' } : clientConfig,
        emulator: config.emulator, emulatorUrl: config.emulator ? 'http://127.0.0.1:9099' : null });
    });
    app.use('/api', limiter, requireUser);
    app.get('/api/auth/me', (req, res) => res.json({ uid: req.account.uid, email: req.account.email }));
  }
  return { register, requireUser, config };
}
module.exports = { createAccountAuth, settings, loopback };
