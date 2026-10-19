const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { RETENTION_MS } = require('./alert-store');
const alertRules = require('../public/assets/js/alertRules');

const hash = value => createHash('sha256').update(value).digest('hex');
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const validWait = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 300;
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{20,4096}$/.test(value);
const validMode = mode => mode === 'threshold' || mode === 'good_time';

function registerAlertApi(app, { store, cache, snapshot, messaging, verificationLimits = {} }) {
  const pending = new Map();
  const capacity = { anonymousPending: 150, registeredPending: 50, anonymousSends: 8, registeredSends: 4, ...verificationLimits };
  const activeSends = { anonymous: 0, registered: 0 };
  const limiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
  const challengeLimiter = rateLimit({ windowMs: 15 * 60000, limit: 5, skip: req => req.registeredOwner, standardHeaders: 'draft-8', legacyHeaders: false });
  const ownerChallengeLimiter = rateLimit({ windowMs: 15 * 60000, limit: 3, keyGenerator: req => req.ownerHash, standardHeaders: 'draft-8', legacyHeaders: false });
  const tokenChallengeLimiter = rateLimit({
    windowMs: 15 * 60000, limit: 3,
    keyGenerator: req => req.registeredOwner ? `registered:${req.ownerHash}:${req.challengeTokenHash}` : `anonymous:${req.challengeTokenHash}`,
    standardHeaders: 'draft-8', legacyHeaders: false
  });
  const mutationLimiter = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.ownerHash, standardHeaders: 'draft-8', legacyHeaders: false });
  function identity(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('Authorization') || '');
    if (!match) return res.status(401).json({ error: true, message: 'This app version needs a private alert identity. Update the app.' });
    req.ownerHash = hash(match[1]);
    next();
  }
  app.use(['/api/alerts', '/api/alert-devices'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, limiter, identity);
  app.use(['/api/alerts', '/api/alert-devices'], (req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !req.path.endsWith('/challenge')) return mutationLimiter(req, res, next);
    next();
  });

  app.post('/api/alert-devices/challenge', (req, res, next) => {
    const token = req.body?.deviceToken;
    if (!validToken(token)) return next(fail(400, 'Invalid notification token'));
    req.challengeSender = messaging();
    if (!req.challengeSender) return next(fail(503, 'Push notifications are not configured'));
    req.registeredOwner = store.state.devices.some(device => device.ownerHash === req.ownerHash && device.expiresAt > Date.now());
    req.challengeTokenHash = hash(token);
    next();
  }, challengeLimiter, ownerChallengeLimiter, tokenChallengeLimiter, asyncRoute(async (req, res) => {
    const token = req.body.deviceToken;
    const sender = req.challengeSender;
    const now = Date.now();
    for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id);
    if ([...pending.values()].some(entry => entry.ownerHash === req.ownerHash)) throw fail(429, 'A device verification is already pending. Try again in two minutes.');
    const lane = req.registeredOwner ? 'registered' : 'anonymous';
    const pendingCount = [...pending.values()].filter(entry => entry.lane === lane).length;
    if (pendingCount >= capacity[`${lane}Pending`] || activeSends[lane] >= capacity[`${lane}Sends`]) {
      throw fail(429, 'Device verification is busy. Please try again shortly.');
    }
    const challengeId = randomUUID();
    const proof = randomBytes(32).toString('hex');
    pending.set(challengeId, { ownerHash: req.ownerHash, token, proofHash: hash(proof), lane, expiresAt: now + 120000 });
    activeSends[lane]++;
    try {
      // The proof is delivered ONLY through push, never returned to the HTTP caller.
      await sender.send({ token, data: { source: 'device-verification', challengeId, proof }, android: { priority: 'high', ttl: 120000 } });
    } catch {
      pending.delete(challengeId);
      throw fail(502, 'Could not verify this device for push notifications');
    } finally {
      activeSends[lane]--;
    }
    res.status(202).json({ challengeId });
  }));

  app.post('/api/alert-devices/verify', asyncRoute(async (req, res) => {
    const { challengeId, proof } = req.body || {};
    const entry = pending.get(challengeId);
    if (!entry || entry.expiresAt <= Date.now() || entry.ownerHash !== req.ownerHash ||
        typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof) || hash(proof) !== entry.proofHash) {
      throw fail(403, 'Device verification failed');
    }
    pending.delete(challengeId);
    await store.transaction(state => {
      if (!state.devices.some(d => d.ownerHash === req.ownerHash) && state.devices.length >= 10000) {
        throw fail(429, 'Device limit reached. Try again later.');
      }
      // A verified reinstall/token rotation revokes the previous association.
      const previousOwners = state.devices.filter(d => d.token === entry.token && d.ownerHash !== req.ownerHash).map(d => d.ownerHash);
      state.devices = state.devices.filter(d => d.ownerHash !== req.ownerHash && d.token !== entry.token);
      state.alerts = state.alerts.filter(a => !previousOwners.includes(a.ownerHash));
      state.devices.push({ ownerHash: req.ownerHash, token: entry.token, expiresAt: Date.now() + RETENTION_MS });
      state.alerts.filter(a => a.ownerHash === req.ownerHash).forEach(a => { a.deviceToken = entry.token; });
    });
    res.json({ success: true });
  }));

  app.get('/api/alert-devices', (req, res) => {
    const device = store.state.devices.find(d => d.ownerHash === req.ownerHash && d.expiresAt > Date.now());
    res.json({ verified: Boolean(device), tokenHash: device ? hash(device.token) : null });
  });
  app.delete('/api/alert-devices', asyncRoute(async (req, res) => {
    await store.transaction(state => {
      state.devices = state.devices.filter(d => d.ownerHash !== req.ownerHash);
      state.alerts = state.alerts.filter(a => a.ownerHash !== req.ownerHash);
    }, { when: state => state.devices.some(d => d.ownerHash === req.ownerHash) || state.alerts.some(a => a.ownerHash === req.ownerHash) });
    for (const [id, entry] of pending) if (entry.ownerHash === req.ownerHash) pending.delete(id);
    res.json({ success: true });
  }));

  app.get('/api/alerts', (req, res) => {
    const validOwner = store.state.devices.some(d => d.ownerHash === req.ownerHash && d.expiresAt > Date.now());
    const cutoff = Date.now() - RETENTION_MS;
    const data = validOwner ? store.state.alerts.filter(a => a.ownerHash === req.ownerHash &&
      Date.parse(a.updatedAt || a.createdAt) > cutoff).map(snapshot).sort((a, b) => Number(b.isTriggered) - Number(a.isTriggered) || a.name.localeCompare(b.name)) : [];
    res.json({ data });
  });
  app.post('/api/alerts', asyncRoute(async (req, res) => {
    const { park, rideId, waitTime, mode = 'threshold' } = req.body || {};
    if (!validMode(mode) || typeof park !== 'string' || !Object.hasOwn(cache, park) || typeof rideId !== 'string' || rideId.length > 150 || (mode === 'threshold' && !validWait(waitTime))) throw fail(400, 'Invalid alert. Choose an alert type and, for a wait threshold, 0 to 300 minutes.');
    const ride = cache[park].data?.liveData?.find(r => r.id === rideId && r.entityType === 'ATTRACTION');
    if (!ride || typeof ride.name !== 'string' || ride.name.length > 250) throw fail(400, 'Ride is unavailable. Refresh the park and try again.');
    if (!store.state.devices.some(d => d.ownerHash === req.ownerHash && d.expiresAt > Date.now())) throw fail(403, 'Verify this device before saving push alerts');
    await store.transaction(state => {
      const device = state.devices.find(d => d.ownerHash === req.ownerHash);
      if (!device) throw fail(403, 'Verify this device before saving push alerts');
      const existing = state.alerts.find(a => a.ownerHash === req.ownerHash && a.park === park && a.rideId === rideId);
      if (existing) {
        if ((existing.mode || 'threshold') !== mode) {
          delete existing.triggeredAt;
          existing.lastObservedWait = alertRules.observation(ride);
        }
        existing.mode = mode;
        existing.waitTime = mode === 'threshold' ? waitTime : null;
        existing.updatedAt = new Date().toISOString();
        // Do not reset notification delivery on repeated identical requests.
      } else {
        if (state.alerts.filter(a => a.ownerHash === req.ownerHash).length >= 50 || state.alerts.length >= 10000) throw fail(429, 'Alert limit reached');
        state.alerts.push({ id: randomUUID(), ownerHash: req.ownerHash, deviceToken: device.token, park, rideId, name: ride.name,
          mode, waitTime: mode === 'threshold' ? waitTime : null, lastObservedWait: alertRules.observation(ride), createdAt: new Date().toISOString() });
      }
    });
    res.status(201).json({ success: true });
  }));
  app.patch('/api/alerts/:id', asyncRoute(async (req, res) => {
    const requestedMode = req.body?.mode;
    if (requestedMode !== undefined && !validMode(requestedMode)) throw fail(400, 'Invalid alert type');
    if (!store.state.alerts.some(a => a.ownerHash === req.ownerHash && a.id === req.params.id)) throw fail(404, 'Alert not found');
    const alert = await store.transaction(state => {
      const alert = state.alerts.find(a => a.ownerHash === req.ownerHash && a.id === req.params.id);
      if (!alert) throw fail(404, 'Alert not found');
      const mode = requestedMode || alert.mode || 'threshold';
      if (mode === 'threshold' && !validWait(req.body?.waitTime)) throw fail(400, 'Enter a whole number from 0 to 300');
      if ((alert.mode || 'threshold') !== mode) {
        delete alert.triggeredAt;
        alert.lastObservedWait = alertRules.observation(cache[alert.park]?.data?.liveData?.find(ride => ride.id === alert.rideId));
      }
      alert.mode = mode;
      alert.waitTime = mode === 'threshold' ? req.body.waitTime : null;
      alert.updatedAt = new Date().toISOString();
      return alert;
    });
    res.json({ success: true, data: snapshot(alert) });
  }));
  app.delete('/api/alerts/:id', asyncRoute(async (req, res) => {
    if (!store.state.alerts.some(a => a.ownerHash === req.ownerHash && a.id === req.params.id)) throw fail(404, 'Alert not found');
    await store.transaction(state => {
      const index = state.alerts.findIndex(a => a.ownerHash === req.ownerHash && a.id === req.params.id);
      if (index < 0) throw fail(404, 'Alert not found');
      state.alerts.splice(index, 1);
    });
    res.json({ success: true });
  }));
}

module.exports = { registerAlertApi };
