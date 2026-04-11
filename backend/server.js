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
  messaging: null
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

async function ensureAlertsFile() {
  await fs.mkdir(path.dirname(ALERTS_FILE), { recursive: true });

  try {
    await fs.access(ALERTS_FILE);
  } catch (error) {
    await fs.writeFile(ALERTS_FILE, "[]", "utf8");
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

async function persistAlerts() {
  await ensureAlertsFile();
  await fs.writeFile(ALERTS_FILE, JSON.stringify(pushState.alerts, null, 2), "utf8");
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
    for (const park in API_URLS) {
      try {
        if (!API_URLS[park]) continue;

        const response = await fetch(API_URLS[park]);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

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
