const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
require("dotenv").config();

let firebaseAdmin = null;
try {
  firebaseAdmin = require("firebase-admin");
} catch (error) {
  console.warn("firebase-admin is not installed. Push notifications are disabled.");
}

const app = express();
const PORT = process.env.PORT || 3000;
const ALERTS_FILE = path.join(__dirname, "data", "alerts.json");
const RESERVATION_ALERTS_FILE = path.join(__dirname, "data", "reservation-alerts.json");
const DISNEY_VERIFICATION_FILE = path.join(__dirname, "data", "disney-verification.json");
const UNIVERSAL_WAIT_HISTORY_FILE = path.join(__dirname, "data", "universal-wait-history.json");
const UNIVERSAL_CACHE_KEYS = new Set(["usorlando", "hollywood"]);
const WAIT_HISTORY_RETENTION_DAYS = 14;
const WAIT_HISTORY_BUCKET_MINUTES = 30;
const WAIT_HISTORY_FORECAST_STEPS = [30, 60, 90, 120];

app.use(cors());
app.use(express.json());

const API_URLS = {
  disneyland: process.env.DISNEYLAND_API,
  hollywood: process.env.HOLLYWOOD_API,
  wdw: process.env.WDW_API,
  usorlando: process.env.USORLANDO_API
};

for (const park in API_URLS) {
  if (!API_URLS[park]) {
    console.warn(`WARNING: Missing API URL for ${park}`);
  }
}

const cache = {};
const pushState = {
  alerts: [],
  reservationAlerts: [],
  disneyVerification: {},
  disneyVerificationCodes: {},
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

function normalizeReservationProvider(provider) {
  return String(provider || "").trim().toLowerCase();
}

function isAuthorizedReservationWorkerRequest(req) {
  const configuredSecret = String(process.env.RESERVATION_WORKER_SHARED_SECRET || "").trim();
  if (!configuredSecret) return false;
  return String(req.headers["x-reservation-worker-secret"] || "").trim() === configuredSecret;
}

async function ensureAlertsFile() {
  await fs.mkdir(path.dirname(ALERTS_FILE), { recursive: true });

  try {
    await fs.access(ALERTS_FILE);
  } catch (error) {
    await fs.writeFile(ALERTS_FILE, "[]", "utf8");
  }
}

async function ensureReservationAlertsFile() {
  await fs.mkdir(path.dirname(RESERVATION_ALERTS_FILE), { recursive: true });

  try {
    await fs.access(RESERVATION_ALERTS_FILE);
  } catch (error) {
    await fs.writeFile(RESERVATION_ALERTS_FILE, "[]", "utf8");
  }
}

async function ensureWaitHistoryFile() {
  await fs.mkdir(path.dirname(UNIVERSAL_WAIT_HISTORY_FILE), { recursive: true });

  try {
    await fs.access(UNIVERSAL_WAIT_HISTORY_FILE);
  } catch (error) {
    await fs.writeFile(UNIVERSAL_WAIT_HISTORY_FILE, "{}", "utf8");
  }
}

async function ensureDisneyVerificationFile() {
  await fs.mkdir(path.dirname(DISNEY_VERIFICATION_FILE), { recursive: true });

  try {
    await fs.access(DISNEY_VERIFICATION_FILE);
  } catch (error) {
    await fs.writeFile(DISNEY_VERIFICATION_FILE, "{}", "utf8");
  }
}

async function loadAlerts() {
  await ensureAlertsFile();

  try {
    const raw = await fs.readFile(ALERTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    pushState.alerts = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load alerts:", error.message);
    pushState.alerts = [];
  }
}

async function loadReservationAlerts() {
  await ensureReservationAlertsFile();

  try {
    const raw = await fs.readFile(RESERVATION_ALERTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    pushState.reservationAlerts = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load reservation alerts:", error.message);
    pushState.reservationAlerts = [];
  }
}

async function loadDisneyVerification() {
  await ensureDisneyVerificationFile();

  try {
    const raw = await fs.readFile(DISNEY_VERIFICATION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    pushState.disneyVerification = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("Failed to load Disney verification state:", error.message);
    pushState.disneyVerification = {};
  }
}

async function persistAlerts() {
  await ensureAlertsFile();
  await fs.writeFile(ALERTS_FILE, JSON.stringify(pushState.alerts, null, 2), "utf8");
}

async function persistReservationAlerts() {
  await ensureReservationAlertsFile();
  await fs.writeFile(RESERVATION_ALERTS_FILE, JSON.stringify(pushState.reservationAlerts, null, 2), "utf8");
}

async function persistDisneyVerification() {
  await ensureDisneyVerificationFile();
  await fs.writeFile(DISNEY_VERIFICATION_FILE, JSON.stringify(pushState.disneyVerification, null, 2), "utf8");
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
  if (firebaseAdmin.apps.length) return firebaseAdmin.messaging();

  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (!serviceAccount) {
    console.warn("Push notifications disabled: missing FIREBASE_SERVICE_ACCOUNT_JSON");
    return null;
  }

  try {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });

    return firebaseAdmin.messaging();
  } catch (error) {
    console.error("Firebase initialization failed:", error.message);
    return null;
  }
}

function buildAlertBody(alert) {
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
    title: "ThemeParkInfo alerts",
    body: `${alerts.length} rides hit your alert settings. Open the app for details.`
  };
}

function evaluateAlert(alert) {
  const cachedData = cache[alert.park]?.data;
  const match = cachedData?.liveData?.find(item => item.name === alert.name);

  if (!match) {
    return {
      status: "Unknown",
      currentWait: null,
      isTriggered: false
    };
  }

  const status = match.status || "Unknown";
  const currentWait = match.queue?.STANDBY?.waitTime ?? null;
  const statusLower = String(status).toLowerCase();
  const isTriggered =
    (statusLower === "operating" && typeof currentWait === "number" && currentWait <= alert.waitTime) ||
    (statusLower && statusLower !== "operating");

  return {
    status,
    currentWait,
    isTriggered,
    isDown: Boolean(statusLower) && statusLower !== "operating"
  };
}

function findTriggeredAlertsForPark(park) {
  const cachedData = cache[park]?.data;
  if (!cachedData?.liveData) return [];

  const parkAlerts = pushState.alerts.filter(alert => alert.park === park);
  if (!parkAlerts.length) return [];

  const triggered = [];

  parkAlerts.forEach(alert => {
    const evaluatedAlert = evaluateAlert(alert);

    if (evaluatedAlert.isTriggered && !alert.triggeredAt) {
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
    ...alert,
    status: evaluatedAlert.status,
    currentWait: evaluatedAlert.currentWait,
    isTriggered: evaluatedAlert.isTriggered,
    lastUpdated: cache[alert.park]?.lastUpdated || null
  };
}

function buildReservationAlertSnapshot(alert) {
  return {
    ...alert,
    status: alert.status || "watching",
    enabled: alert.enabled !== false,
    lastCheckedAt: alert.lastCheckedAt || null,
    lastMatchAt: alert.lastMatchAt || null
  };
}

function buildDisneyVerificationSnapshot(provider, includeCode = false) {
  const entry = pushState.disneyVerification[provider];
  if (!entry) return null;

  return {
    provider,
    status: entry.status || "required",
    message: entry.message || "",
    promptText: entry.promptText || "",
    updatedAt: entry.updatedAt || null,
    submittedAt: entry.submittedAt || null,
    code: includeCode ? pushState.disneyVerificationCodes[provider] || "" : undefined
  };
}

function sortDisneyVerificationStates(includeCode = false) {
  return ["wdw", "disneyland"]
    .map(provider => buildDisneyVerificationSnapshot(provider, includeCode))
    .filter(Boolean);
}

function sortReservationAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    if ((a.enabled !== false) !== (b.enabled !== false)) {
      return a.enabled === false ? 1 : -1;
    }

    if (a.preferredDate && b.preferredDate && a.preferredDate !== b.preferredDate) {
      return a.preferredDate.localeCompare(b.preferredDate);
    }

    return String(a.restaurantName || "").localeCompare(String(b.restaurantName || ""));
  });
}

function reconcileTriggeredStateForPark(park) {
  let changed = false;

  pushState.alerts.forEach(alert => {
    if (alert.park !== park) return;

    const evaluatedAlert = evaluateAlert(alert);

    if (!evaluatedAlert.isTriggered && alert.triggeredAt) {
      delete alert.triggeredAt;
      changed = true;
    }
  });

  return changed;
}

async function sendTriggeredNotifications(triggeredAlerts) {
  if (!triggeredAlerts.length) return;
  if (!pushState.messaging) {
    console.warn("Triggered alerts found, but Firebase is not configured.");
    return;
  }

  const alertsByToken = new Map();
  const deliveredAlertIds = new Set();
  const invalidTokens = new Set();

  triggeredAlerts.forEach(alert => {
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
        console.error(`Push send failed for token ${deviceToken}:`, error.message);

        if (
          error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.add(deviceToken);
        }
      }
    })
  );

  if (!deliveredAlertIds.size && !invalidTokens.size) return;

  let changed = false;

  pushState.alerts = pushState.alerts.filter(alert => {
    if (invalidTokens.has(alert.deviceToken)) {
      changed = true;
      return false;
    }

    if (deliveredAlertIds.has(alert.id)) {
      alert.triggeredAt = new Date().toISOString();
      changed = true;
    }

    return true;
  });

  if (changed) {
    await persistAlerts();
  }
}

async function processTriggeredAlertsForPark(park) {
  await sendTriggeredNotifications(findTriggeredAlertsForPark(park));
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
        if (!API_URLS[park]) continue;

        const response = await fetch(API_URLS[park]);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (UNIVERSAL_CACHE_KEYS.has(park)) {
          shouldPersistWaitHistory = updateUniversalWaitHistory(data, new Date()) || shouldPersistWaitHistory;
          attachUniversalForecasts(data, new Date());
        }

        cache[park].data = data;
        cache[park].lastUpdated = new Date();
        cache[park].error = null;

        console.log(`${park} updated at ${cache[park].lastUpdated.toISOString()}`);
        await processTriggeredAlertsForPark(park);
        if (reconcileTriggeredStateForPark(park)) {
          await persistAlerts();
        }
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

app.post("/api/alerts", async (req, res) => {
  const park = normalizeParkKey(req.body.park);
  const name = String(req.body.name || "").trim();
  const deviceToken = String(req.body.deviceToken || "").trim();
  const waitTime = Number(req.body.waitTime);

  if (!API_URLS[park]) {
    return res.status(400).json({
      error: true,
      message: "Invalid park"
    });
  }

  if (!name || !deviceToken || !Number.isFinite(waitTime) || waitTime < 0) {
    return res.status(400).json({
      error: true,
      message: "Missing or invalid alert fields"
    });
  }

  const existingAlert = pushState.alerts.find(alert =>
    alert.deviceToken === deviceToken &&
    alert.park === park &&
    alert.name === name
  );

  if (existingAlert) {
    existingAlert.waitTime = waitTime;
    existingAlert.updatedAt = new Date().toISOString();
    delete existingAlert.triggeredAt;
  } else {
    pushState.alerts.push({
      id: randomUUID(),
      park,
      name,
      waitTime,
      deviceToken,
      createdAt: new Date().toISOString()
    });
  }

  await persistAlerts();

  res.status(201).json({
    success: true,
    message: "Alert saved for server-side push notifications"
  });
});

app.get("/api/alerts", (req, res) => {
  const alerts = pushState.alerts
    .map(buildAlertSnapshot)
    .sort((a, b) => {
      if (a.isTriggered !== b.isTriggered) {
        return a.isTriggered ? -1 : 1;
      }

      if (a.triggeredAt && b.triggeredAt) {
        return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
      }

      return a.name.localeCompare(b.name);
    });

  res.json({
    data: alerts
  });
});

app.post("/api/reservation-alerts", async (req, res) => {
  const provider = normalizeReservationProvider(req.body.provider);
  const restaurantName = String(req.body.restaurantName || "").trim();
  const partySize = Number(req.body.partySize);
  const preferredDate = String(req.body.preferredDate || "").trim();
  const startTime = String(req.body.startTime || "").trim();
  const endTime = String(req.body.endTime || "").trim();
  const ownerKey = String(req.body.ownerKey || "").trim();
  const deviceToken = String(req.body.deviceToken || "").trim();

  const validProviders = new Set(["wdw", "disneyland", "usorlando", "hollywood"]);

  if (!validProviders.has(provider)) {
    return res.status(400).json({
      error: true,
      message: "Invalid reservation provider"
    });
  }

  if (!restaurantName || !ownerKey || !Number.isFinite(partySize) || partySize < 1 || !preferredDate || !startTime || !endTime) {
    return res.status(400).json({
      error: true,
      message: "Missing or invalid reservation alert fields"
    });
  }

  const existingAlert = pushState.reservationAlerts.find(alert =>
    alert.ownerKey === ownerKey &&
    alert.provider === provider &&
    alert.restaurantName.toLowerCase() === restaurantName.toLowerCase() &&
    alert.preferredDate === preferredDate
  );

  if (existingAlert) {
    existingAlert.partySize = partySize;
    existingAlert.startTime = startTime;
    existingAlert.endTime = endTime;
    existingAlert.enabled = true;
    existingAlert.updatedAt = new Date().toISOString();
    existingAlert.deviceToken = deviceToken || existingAlert.deviceToken || "";
    await persistReservationAlerts();

    return res.status(201).json({
      success: true,
      data: buildReservationAlertSnapshot(existingAlert)
    });
  }

  const newAlert = {
    id: randomUUID(),
    provider,
    restaurantName,
    partySize,
    preferredDate,
    startTime,
    endTime,
    ownerKey,
    deviceToken,
    enabled: true,
    status: "watching",
    createdAt: new Date().toISOString()
  };

  pushState.reservationAlerts.push(newAlert);
  await persistReservationAlerts();

  return res.status(201).json({
    success: true,
    data: buildReservationAlertSnapshot(newAlert)
  });
});

app.get("/api/reservation-alerts", (req, res) => {
  const ownerKey = String(req.query.ownerKey || "").trim();
  const alerts = ownerKey
    ? pushState.reservationAlerts.filter(alert => alert.ownerKey === ownerKey)
    : pushState.reservationAlerts;

  return res.json({
    data: sortReservationAlerts(alerts).map(buildReservationAlertSnapshot)
  });
});

app.get("/api/reservation-worker/disney-verification", (req, res) => {
  const provider = normalizeReservationProvider(req.query.provider);
  const includeCode = isAuthorizedReservationWorkerRequest(req);

  if (provider) {
    return res.json({
      data: buildDisneyVerificationSnapshot(provider, includeCode)
    });
  }

  return res.json({
    data: sortDisneyVerificationStates(includeCode)
  });
});

app.post("/api/reservation-worker/disney-verification/:provider/request", async (req, res) => {
  if (!isAuthorizedReservationWorkerRequest(req)) {
    return res.status(403).json({
      error: true,
      message: "Unauthorized worker request"
    });
  }

  const provider = normalizeReservationProvider(req.params.provider);
  if (!["wdw", "disneyland"].includes(provider)) {
    return res.status(400).json({
      error: true,
      message: "Invalid Disney provider"
    });
  }

  pushState.disneyVerification[provider] = {
    status: String(req.body.status || "required").trim() || "required",
    message: String(req.body.message || "").trim(),
    promptText: String(req.body.promptText || "").trim(),
    updatedAt: new Date().toISOString(),
    submittedAt: null
  };
  delete pushState.disneyVerificationCodes[provider];

  await persistDisneyVerification();

  return res.json({
    success: true,
    data: buildDisneyVerificationSnapshot(provider, false)
  });
});

app.post("/api/reservation-worker/disney-verification/:provider/code", async (req, res) => {
  const provider = normalizeReservationProvider(req.params.provider);
  const code = String(req.body.code || "").trim();
  const ownerKey = String(req.body.ownerKey || "").trim();

  if (!["wdw", "disneyland"].includes(provider)) {
    return res.status(400).json({
      error: true,
      message: "Invalid Disney provider"
    });
  }

  if (!code) {
    return res.status(400).json({
      error: true,
      message: "Verification code is required"
    });
  }

  if (!ownerKey) {
    return res.status(400).json({
      error: true,
      message: "Owner key is required"
    });
  }

  const ownsProviderAlert = pushState.reservationAlerts.some(alert =>
    alert &&
    alert.ownerKey === ownerKey &&
    alert.provider === provider
  );

  if (!ownsProviderAlert) {
    return res.status(403).json({
      error: true,
      message: "This device does not have a Disney reservation alert for that provider"
    });
  }

  const existing = pushState.disneyVerification[provider] || {};
  pushState.disneyVerification[provider] = {
    ...existing,
    status: "submitted",
    updatedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString()
  };
  pushState.disneyVerificationCodes[provider] = code;

  await persistDisneyVerification();

  return res.json({
    success: true,
    data: buildDisneyVerificationSnapshot(provider, false)
  });
});

app.post("/api/reservation-worker/disney-verification/:provider/clear", async (req, res) => {
  if (!isAuthorizedReservationWorkerRequest(req)) {
    return res.status(403).json({
      error: true,
      message: "Unauthorized worker request"
    });
  }

  const provider = normalizeReservationProvider(req.params.provider);
  if (!["wdw", "disneyland"].includes(provider)) {
    return res.status(400).json({
      error: true,
      message: "Invalid Disney provider"
    });
  }

  delete pushState.disneyVerification[provider];
  delete pushState.disneyVerificationCodes[provider];
  await persistDisneyVerification();

  return res.json({
    success: true
  });
});

app.patch("/api/reservation-alerts/:id", async (req, res) => {
  const alertId = String(req.params.id || "").trim();
  const ownerKey = String(req.body.ownerKey || "").trim();
  const alert = pushState.reservationAlerts.find(entry => entry.id === alertId);
  const isWorkerRequest = isAuthorizedReservationWorkerRequest(req);

  if (!alert) {
    return res.status(404).json({
      error: true,
      message: "Reservation alert not found"
    });
  }

  if (!isWorkerRequest && ownerKey && alert.ownerKey !== ownerKey) {
    return res.status(403).json({
      error: true,
      message: "This reservation alert does not belong to this device"
    });
  }

  if (req.body.restaurantName !== undefined) {
    const restaurantName = String(req.body.restaurantName || "").trim();
    if (!restaurantName) {
      return res.status(400).json({
        error: true,
        message: "Restaurant name is required"
      });
    }
    alert.restaurantName = restaurantName;
  }

  if (req.body.partySize !== undefined) {
    const partySize = Number(req.body.partySize);
    if (!Number.isFinite(partySize) || partySize < 1) {
      return res.status(400).json({
        error: true,
        message: "Party size must be at least 1"
      });
    }
    alert.partySize = partySize;
  }

  if (req.body.preferredDate !== undefined) {
    const preferredDate = String(req.body.preferredDate || "").trim();
    if (!preferredDate) {
      return res.status(400).json({
        error: true,
        message: "Preferred date is required"
      });
    }
    alert.preferredDate = preferredDate;
  }

  if (req.body.startTime !== undefined) {
    const startTime = String(req.body.startTime || "").trim();
    if (!startTime) {
      return res.status(400).json({
        error: true,
        message: "Start time is required"
      });
    }
    alert.startTime = startTime;
  }

  if (req.body.endTime !== undefined) {
    const endTime = String(req.body.endTime || "").trim();
    if (!endTime) {
      return res.status(400).json({
        error: true,
        message: "End time is required"
      });
    }
    alert.endTime = endTime;
  }

  if (req.body.enabled !== undefined) {
    alert.enabled = Boolean(req.body.enabled);
  }

  if (isWorkerRequest) {
    if (req.body.status !== undefined) {
      alert.status = String(req.body.status || "").trim() || alert.status || "watching";
    }

    if (req.body.lastCheckedAt !== undefined) {
      alert.lastCheckedAt = req.body.lastCheckedAt || null;
    }

    if (req.body.lastMatchAt !== undefined) {
      alert.lastMatchAt = req.body.lastMatchAt || null;
    }

    if (req.body.deviceToken !== undefined) {
      alert.deviceToken = String(req.body.deviceToken || "").trim();
    }
  }

  alert.updatedAt = new Date().toISOString();
  await persistReservationAlerts();

  return res.json({
    success: true,
    data: buildReservationAlertSnapshot(alert)
  });
});

app.delete("/api/reservation-alerts/:id", async (req, res) => {
  const alertId = String(req.params.id || "").trim();
  const ownerKey = String(req.query.ownerKey || "").trim();
  const alert = pushState.reservationAlerts.find(entry => entry.id === alertId);
  const isWorkerRequest = isAuthorizedReservationWorkerRequest(req);

  if (!alert) {
    return res.status(404).json({
      error: true,
      message: "Reservation alert not found"
    });
  }

  if (!isWorkerRequest && ownerKey && alert.ownerKey !== ownerKey) {
    return res.status(403).json({
      error: true,
      message: "This reservation alert does not belong to this device"
    });
  }

  pushState.reservationAlerts = pushState.reservationAlerts.filter(entry => entry.id !== alertId);
  await persistReservationAlerts();

  return res.json({
    success: true
  });
});

app.patch("/api/alerts/:id", async (req, res) => {
  const alertId = String(req.params.id || "").trim();
  const waitTime = Number(req.body.waitTime);

  if (!alertId || !Number.isFinite(waitTime) || waitTime < 0) {
    return res.status(400).json({
      error: true,
      message: "Missing or invalid alert update"
    });
  }

  const alert = pushState.alerts.find(entry => entry.id === alertId);
  if (!alert) {
    return res.status(404).json({
      error: true,
      message: "Alert not found"
    });
  }

  alert.waitTime = waitTime;
  alert.updatedAt = new Date().toISOString();
  await persistAlerts();

  return res.json({
    success: true,
    data: buildAlertSnapshot(alert)
  });
});

app.delete("/api/alerts/:id", async (req, res) => {
  const alertId = String(req.params.id || "").trim();
  const previousCount = pushState.alerts.length;

  pushState.alerts = pushState.alerts.filter(entry => entry.id !== alertId);

  if (pushState.alerts.length === previousCount) {
    return res.status(404).json({
      error: true,
      message: "Alert not found"
    });
  }

  await persistAlerts();

  return res.json({
    success: true
  });
});

app.get("/api/:park", (req, res) => {
  const park = normalizeParkKey(req.params.park);

  console.log(`API request for: ${park}`);

  if (!cache[park]) {
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
});

app.get("/test", (req, res) => {
  res.send("SERVER IS WORKING");
});

app.use(express.static(path.join(__dirname, "../public")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

async function startServer() {
  pushState.messaging = initializeFirebaseMessaging();
  await loadAlerts();
  await loadReservationAlerts();
  await loadDisneyVerification();
  await loadWaitHistory();
  await updateCache();

  setInterval(() => {
    updateCache().catch(error => {
      console.error("Unexpected cache update error:", error.message);
    });
  }, 30000);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(error => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
