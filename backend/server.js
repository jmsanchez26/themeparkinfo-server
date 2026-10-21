const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const helmet = require("helmet");
const { AlertStore } = require("./alert-store");
const { registerAlertApi } = require("./alert-api");
const { fetchParkData, useHostedParkData } = require("./park-data");
const alertRules = require("../public/assets/js/alertRules");
const { createPublicApiLimiter } = require("./api-limits");
require("dotenv").config();
const { createAccountAuth } = require('./account-auth');
const accountAuth = createAccountAuth();

let firebaseAdmin = null;
try {
  firebaseAdmin = {
    ...require("firebase-admin/app"),
    ...require("firebase-admin/messaging")
  };
} catch (error) {
  console.warn("firebase-admin is not installed. Push notifications are disabled.");
}

const app = express();
// Configure only the known number of reverse-proxy hops; never trust all proxies.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 3) throw new Error('Invalid TRUST_PROXY_HOPS');
if (proxyHops) app.set('trust proxy', proxyHops);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const alertStore = new AlertStore(path.join(DATA_DIR, "secure-alerts.json"));
const UNIVERSAL_WAIT_HISTORY_FILE = path.join(DATA_DIR, "universal-wait-history.json");
const UNIVERSAL_CACHE_KEYS = new Set(["usorlando", "hollywood"]);
const WAIT_HISTORY_RETENTION_DAYS = 14;
const WAIT_HISTORY_BUCKET_MINUTES = 30;
const WAIT_HISTORY_FORECAST_STEPS = [30, 60, 90, 120];

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://apis.google.com"], scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
  fontSrc: ["'self'", "https://cdnjs.cloudflare.com"], imgSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "https://api.themeparks.wiki", "https://themeparkinfo-api.onrender.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://www.googleapis.com", ...(accountAuth.config.emulator ? ['http://127.0.0.1:9099'] : [])],
  frameSrc: ["https://www.google.com", "https://themeparkinfo-ba1e8.firebaseapp.com"], objectSrc: ["'none'"], baseUri: ["'self'"], upgradeInsecureRequests: null
}}, crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
const allowedOrigins = new Set(["capacitor://localhost", "http://localhost", "https://localhost",
  "https://themeparkinfo-api.onrender.com", ...(process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)]);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "Authorization", "X-Firebase-ID-Token"] }));
app.use(express.json({ limit: "12kb" }));
accountAuth.register(app);

const API_URLS = {
  disneyland: process.env.DISNEYLAND_API,
  hollywood: process.env.HOLLYWOOD_API,
  wdw: process.env.WDW_API,
  usorlando: process.env.USORLANDO_API
};

for (const park in API_URLS) {
  if (!API_URLS[park]) {
    console.warn(useHostedParkData(API_URLS[park])
      ? `Local development: ${park} will use public park data from Render`
      : `WARNING: Missing API URL for ${park}`);
  }
}

const cache = {};
const pushState = {
  get alerts() { return alertStore.state.alerts; },
  messaging: null
};
const waitHistoryState = {
  rides: {}
};

let isUpdatingCache = false;

Object.keys(API_URLS).forEach(park => {
  cache[park] = {
    data: null,
    lastUpdated: null,
    error: null
  };
});

function normalizeParkKey(park) {
  return String(park || "").trim().toLowerCase();
}

async function ensureWaitHistoryFile() {
  await fs.mkdir(path.dirname(UNIVERSAL_WAIT_HISTORY_FILE), { recursive: true });

  try {
    await fs.access(UNIVERSAL_WAIT_HISTORY_FILE);
  } catch (error) {
    await fs.writeFile(UNIVERSAL_WAIT_HISTORY_FILE, "{}", "utf8");
  }
}

async function loadWaitHistory() {
  await ensureWaitHistoryFile();

  try {
    const raw = await fs.readFile(UNIVERSAL_WAIT_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    waitHistoryState.rides = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to load Universal wait history:", error.message);
    waitHistoryState.rides = {};
  }
}

async function persistWaitHistory() {
  await ensureWaitHistoryFile();
  await fs.writeFile(UNIVERSAL_WAIT_HISTORY_FILE, JSON.stringify(waitHistoryState.rides, null, 2), "utf8");
}

function isOperatingWaitItem(item) {
  return (
    item &&
    String(item.entityType || "").toUpperCase() === "ATTRACTION" &&
    String(item.status || "").toLowerCase() === "operating" &&
    Number.isFinite(item.queue?.STANDBY?.waitTime)
  );
}

function buildHistoryRideKey(item) {
  return `${item.parkId}::${item.id}`;
}

function isWeekendDate(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function getBucketIndex(date) {
  return date.getUTCHours() * (60 / WAIT_HISTORY_BUCKET_MINUTES) + Math.floor(date.getUTCMinutes() / WAIT_HISTORY_BUCKET_MINUTES);
}

function clampWaitTime(value) {
  return Math.max(0, Math.min(300, Math.round(value)));
}

function trimRideHistoryEntries(entries, nowMs) {
  const cutoffMs = nowMs - WAIT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return entries
    .filter(entry => Number.isFinite(entry.waitTime) && entry.timestamp && new Date(entry.timestamp).getTime() >= cutoffMs)
    .slice(-800);
}

function updateUniversalWaitHistory(data, fetchedAt) {
  const nowMs = fetchedAt.getTime();
  let changed = false;

  data?.liveData?.forEach(item => {
    if (!isOperatingWaitItem(item)) return;

    const rideKey = buildHistoryRideKey(item);
    const existingEntries = Array.isArray(waitHistoryState.rides[rideKey]) ? waitHistoryState.rides[rideKey] : [];
    const trimmedEntries = trimRideHistoryEntries(existingEntries, nowMs);
    const waitTime = item.queue.STANDBY.waitTime;
    const lastEntry = trimmedEntries[trimmedEntries.length - 1];

    if (
      lastEntry &&
      lastEntry.waitTime === waitTime &&
      nowMs - new Date(lastEntry.timestamp).getTime() < 25 * 60 * 1000
    ) {
      waitHistoryState.rides[rideKey] = trimmedEntries;
      return;
    }

    trimmedEntries.push({
      timestamp: fetchedAt.toISOString(),
      waitTime
    });

    waitHistoryState.rides[rideKey] = trimmedEntries;
    changed = true;
  });

  return changed;
}

function buildSyntheticForecastFromHistory(entries, currentWait, now) {
  if (!Array.isArray(entries) || entries.length < 3 || !Number.isFinite(currentWait)) {
    return null;
  }

  const nowMs = now.getTime();
  const recentWindowMs = 3 * 60 * 60 * 1000;
  const recentEntries = entries
    .map(entry => ({
      waitTime: entry.waitTime,
      date: new Date(entry.timestamp)
    }))
    .filter(entry => !Number.isNaN(entry.date.getTime()) && nowMs - entry.date.getTime() <= recentWindowMs)
    .sort((a, b) => a.date - b.date);

  if (!recentEntries.length) {
    return null;
  }

  const firstRecent = recentEntries[0];
  const lastRecent = recentEntries[recentEntries.length - 1];
  const elapsedMinutes = Math.max(30, (lastRecent.date.getTime() - firstRecent.date.getTime()) / 60000);
  const trendPerMinute = recentEntries.length > 1 ? (lastRecent.waitTime - firstRecent.waitTime) / elapsedMinutes : 0;
  const todayIsWeekend = isWeekendDate(now);

  const forecast = WAIT_HISTORY_FORECAST_STEPS.map(stepMinutes => {
    const targetDate = new Date(nowMs + stepMinutes * 60 * 1000);
    const targetBucket = getBucketIndex(targetDate);
    const matchingSamples = entries
      .map(entry => ({
        waitTime: entry.waitTime,
        date: new Date(entry.timestamp)
      }))
      .filter(entry => {
        if (Number.isNaN(entry.date.getTime())) return false;
        if (isWeekendDate(entry.date) !== todayIsWeekend) return false;
        return getBucketIndex(entry.date) === targetBucket;
      })
      .map(entry => entry.waitTime);

    const trendEstimate = currentWait + trendPerMinute * stepMinutes;
    const averageEstimate = matchingSamples.length
      ? matchingSamples.reduce((sum, wait) => sum + wait, 0) / matchingSamples.length
      : null;

    const blendedEstimate = averageEstimate === null
      ? trendEstimate
      : averageEstimate * 0.7 + trendEstimate * 0.3;

    return {
      time: targetDate.toISOString(),
      waitTime: clampWaitTime(blendedEstimate)
    };
  });

  return forecast.some(point => Number.isFinite(point.waitTime)) ? forecast : null;
}

function attachUniversalForecasts(data, fetchedAt) {
  data?.liveData?.forEach(item => {
    if (!isOperatingWaitItem(item)) return;
    if (Array.isArray(item.forecast) && item.forecast.length) return;

    const rideKey = buildHistoryRideKey(item);
    const rideHistory = waitHistoryState.rides[rideKey];
    const syntheticForecast = buildSyntheticForecastFromHistory(
      rideHistory,
      item.queue?.STANDBY?.waitTime,
      fetchedAt
    );

    if (syntheticForecast?.length) {
      item.forecast = syntheticForecast;
    }
  });
}

function parseServiceAccount(rawValue) {
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(rawValue, "base64").toString("utf8"));
    } catch (decodeError) {
      console.error("Could not parse FIREBASE_SERVICE_ACCOUNT_JSON");
      return null;
    }
  }
}

function initializeFirebaseMessaging() {
  if (!firebaseAdmin) return null;

  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (!serviceAccount) {
    console.warn("Push notifications disabled: missing FIREBASE_SERVICE_ACCOUNT_JSON");
    return null;
  }

  try {
    const firebaseApp = firebaseAdmin.getApps().find(app => app.name === "[DEFAULT]") || firebaseAdmin.initializeApp({
      credential: firebaseAdmin.cert(serviceAccount)
    });

    return firebaseAdmin.getMessaging(firebaseApp);
  } catch (error) {
    console.error("Firebase initialization failed:", error.message);
    return null;
  }
}

function buildAlertBody(alert) {
  if (alert.mode === 'good_time') {
    return `${alert.name} dropped to ${alert.currentWait} min. It's a good time to ride!`;
  }
  if (alert.isDown) {
    return `${alert.name} is currently ${alert.status || "down"}.`;
  }

  return `${alert.name} is now ${alert.currentWait} min. Your alert was ${alert.waitTime} min.`;
}

function buildAggregatedMessage(alerts) {
  if (alerts.length === 1) {
    return {
      title: alerts[0].name,
      body: buildAlertBody(alerts[0])
    };
  }

  return {
    title: "Adventure Scout alerts",
    body: `${alerts.length} rides hit your alert settings. Open the app for details.`
  };
}

function evaluateAlert(alert) {
  const cachedData = cache[alert.park]?.data;
  const match = cachedData?.liveData?.find(item => item.id === alert.rideId);

  return alertRules.evaluate(alert, match);
}

function findTriggeredAlertsForPark(park) {
  const cachedData = cache[park]?.data;
  if (!cachedData?.liveData) return [];

  const activeOwners = new Set(alertStore.state.devices.filter(d => d.expiresAt > Date.now()).map(d => d.ownerHash));
  const parkAlerts = pushState.alerts.filter(alert => alert.park === park && activeOwners.has(alert.ownerHash) && Date.parse(alert.updatedAt || alert.createdAt) > Date.now() - 30 * 86400000);
  if (!parkAlerts.length) return [];

  const triggered = [];

  parkAlerts.forEach(alert => {
    const evaluatedAlert = evaluateAlert(alert);

    if (evaluatedAlert.isTriggered && (alert.mode === 'good_time' || !alert.triggeredAt)) {
      triggered.push({
        ...alert,
        ...evaluatedAlert
      });
    }
  });

  return triggered;
}

function buildAlertSnapshot(alert) {
  const evaluatedAlert = evaluateAlert(alert);

  return {
    id: alert.id, park: alert.park, rideId: alert.rideId, name: alert.name,
    waitTime: alert.waitTime, createdAt: alert.createdAt, updatedAt: alert.updatedAt,
    mode: alert.mode || 'threshold',
    triggeredAt: alert.triggeredAt,
    status: evaluatedAlert.status,
    currentWait: evaluatedAlert.currentWait,
    goodTimeToRide: evaluatedAlert.goodTimeToRide,
    isTriggered: evaluatedAlert.isTriggered,
    lastUpdated: cache[alert.park]?.lastUpdated || null
  };
}

async function reconcileTriggeredStateForPark(park) {
  if (!pushState.alerts.some(a => a.park === park && a.mode !== 'good_time' && a.triggeredAt && !evaluateAlert(a).isTriggered)) return;
  await alertStore.transaction(state => {
    state.alerts.forEach(alert => {
      if (alert.park === park && alert.mode !== 'good_time' && !evaluateAlert(alert).isTriggered) delete alert.triggeredAt;
    });
  });
}

async function sendTriggeredNotifications(triggeredAlerts) {
  if (!triggeredAlerts.length) return new Set();
  if (!pushState.messaging) {
    console.warn("Triggered alerts found, but Firebase is not configured.");
    return new Set();
  }

  const alertsByToken = new Map();
  const deliveredAlertIds = new Set();
  const invalidTokens = new Set();

  triggeredAlerts.forEach(alert => {
    if (!alert.deviceToken) return;
    const existingAlerts = alertsByToken.get(alert.deviceToken) || [];
    existingAlerts.push(alert);
    alertsByToken.set(alert.deviceToken, existingAlerts);
  });

  await Promise.allSettled(
    [...alertsByToken.entries()].map(async ([deviceToken, alerts]) => {
      const message = buildAggregatedMessage(alerts);

      try {
        await pushState.messaging.send({
          token: deviceToken,
          notification: {
            title: message.title,
            body: message.body
          },
          data: {
            source: "wait-alert",
            park: alerts[0].park,
            targetPath: "/pages/alerts.html"
          },
          android: {
            priority: "high"
          }
        });

        alerts.forEach(alert => {
          deliveredAlertIds.add(alert.id);
        });
      } catch (error) {
        console.error("Push delivery failed:", error.code || "unknown");

        if (
          error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.add(deviceToken);
        }
      }
    })
  );

  if (!deliveredAlertIds.size && !invalidTokens.size) return deliveredAlertIds;

  await alertStore.transaction(state => {
    state.devices = state.devices.filter(d => !invalidTokens.has(d.token));
    state.alerts = state.alerts.filter(alert => {
      if (invalidTokens.has(alert.deviceToken)) return false;
      if (deliveredAlertIds.has(alert.id)) alert.triggeredAt = new Date().toISOString();
      return true;
    });
  });
  return deliveredAlertIds;
}

async function processTriggeredAlertsForPark(park) {
  const triggered = findTriggeredAlertsForPark(park);
  const delivered = await sendTriggeredNotifications(triggered);
  const retryIds = new Set(triggered.filter(alert => alert.mode === 'good_time' && !delivered.has(alert.id)).map(alert => alert.id));
  const smart = pushState.alerts.filter(alert => alert.park === park && alert.mode === 'good_time' && !retryIds.has(alert.id));
  if (smart.some(alert => alert.lastObservedWait !== alertRules.observation(cache[park]?.data?.liveData?.find(ride => ride.id === alert.rideId)))) {
    await alertStore.transaction(state => {
      state.alerts.filter(alert => alert.park === park && alert.mode === 'good_time' && !retryIds.has(alert.id)).forEach(alert => {
        alert.lastObservedWait = alertRules.observation(cache[park]?.data?.liveData?.find(ride => ride.id === alert.rideId));
      });
    });
  }
}

async function updateCache() {
  if (isUpdatingCache) {
    console.log("Skipping cache refresh because a previous run is still active.");
    return;
  }

  isUpdatingCache = true;
  console.log("Updating park caches...");

  try {
    let shouldPersistWaitHistory = false;

    for (const park in API_URLS) {
      try {
        const result = await fetchParkData(park, API_URLS[park]);
        if (!result) continue;
        const { data, hosted } = result;

        if (!hosted && UNIVERSAL_CACHE_KEYS.has(park)) {
          shouldPersistWaitHistory = updateUniversalWaitHistory(data, new Date()) || shouldPersistWaitHistory;
          attachUniversalForecasts(data, new Date());
        }

        cache[park].data = data;
        const hostedTimestamp = result.lastUpdated && new Date(result.lastUpdated);
        cache[park].lastUpdated = hostedTimestamp && !Number.isNaN(hostedTimestamp.getTime()) ? hostedTimestamp : new Date();
        cache[park].error = null;

        console.log(`${park} updated at ${cache[park].lastUpdated.toISOString()}`);
        await processTriggeredAlertsForPark(park);
        await reconcileTriggeredStateForPark(park);
      } catch (error) {
        console.error(`Error updating ${park}:`, error.message);
        cache[park].error = error.message;
      }
    }

    if (shouldPersistWaitHistory) {
      await persistWaitHistory();
    }
  } finally {
    isUpdatingCache = false;
  }
}

registerAlertApi(app, { store: alertStore, cache, snapshot: buildAlertSnapshot, messaging: () => pushState.messaging });

function parkResponse(req, res) {
  const park = normalizeParkKey(req.params.park);

  console.log(`API request for: ${park}`);

  if (!Object.hasOwn(cache, park)) {
    return res.status(404).json({
      error: true,
      message: "Park not found"
    });
  }

  if (!cache[park].data) {
    return res.status(503).json({
      error: true,
      message: "Live data unavailable",
      data: { liveData: [] }
    });
  }

  if (cache[park].error) {
    return res.json({
      warning: true,
      message: "Using cached data (API temporarily unavailable)",
      lastUpdated: cache[park].lastUpdated,
      data: cache[park].data
    });
  }

  return res.json({
    lastUpdated: cache[park].lastUpdated,
    data: cache[park].data
  });
}
app.get('/api/:park', createPublicApiLimiter(), parkResponse);
// Only aggregated, public park information is available here; never user data.
// This keeps keyless local emulator testing independent of production accounts.
app.get('/park-feed/:park', createPublicApiLimiter(), parkResponse);

app.get("/test", (req, res) => {
  res.send("SERVER IS WORKING");
});

app.use("/api", (req, res) => res.status(404).json({ error: true, message: "Not found" }));

app.use(express.static(path.join(__dirname, "../public")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

async function startServer() {
  pushState.messaging = initializeFirebaseMessaging();
  await alertStore.load();
  // Legacy records have no owner credential and cannot be safely migrated.
  await fs.unlink(path.join(DATA_DIR, 'alerts.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await loadWaitHistory();
  await updateCache();

  setInterval(() => {
    updateCache().catch(error => {
      console.error("Unexpected cache update error:", error.message);
    });
  }, 30000);

  setInterval(() => {
    alertStore.transaction(() => {}).catch(() => console.error('Private alert retention cleanup failed'));
  }, 60 * 60 * 1000);

  app.listen(PORT, accountAuth.config.emulator ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  console.error("Request failed:", status);
  res.status(status).json({ error: true, message: error.publicMessage || (status === 400 ? "Invalid request" : status === 413 ? "Request too large" : "Request could not be completed") });
});
module.exports = { app, alertStore, cache, buildAlertSnapshot, initializeFirebaseMessaging, processTriggeredAlertsForPark, pushState };
if (require.main === module) startServer().catch(error => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
