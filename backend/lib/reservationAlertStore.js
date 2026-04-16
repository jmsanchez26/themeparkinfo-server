const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const RESERVATION_ALERTS_FILE = path.join(DATA_DIR, "reservation-alerts.json");
const RESERVATION_QUERY_CACHE_FILE = path.join(DATA_DIR, "reservation-query-cache.json");
const RESERVATION_API_BASE_URL = String(process.env.RESERVATION_API_BASE_URL || "").trim().replace(/\/+$/, "");
const RESERVATION_WORKER_SHARED_SECRET = String(process.env.RESERVATION_WORKER_SHARED_SECRET || "").trim();

async function ensureFile(filePath, fallbackContents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch (error) {
    await fs.writeFile(filePath, fallbackContents, "utf8");
  }
}

async function readJsonFile(filePath, fallbackValue) {
  await ensureFile(filePath, JSON.stringify(fallbackValue, null, 2));

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read ${path.basename(filePath)}:`, error.message);
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureFile(filePath, JSON.stringify(value, null, 2));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getSharedHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (RESERVATION_WORKER_SHARED_SECRET) {
    headers["x-reservation-worker-secret"] = RESERVATION_WORKER_SHARED_SECRET;
  }

  return headers;
}

function shouldUseApiBackedAlerts() {
  return Boolean(RESERVATION_API_BASE_URL);
}

async function apiRequest(route, options = {}) {
  const response = await fetch(`${RESERVATION_API_BASE_URL}${route}`, {
    ...options,
    headers: {
      ...getSharedHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Reservation API request failed (${response.status}) ${message}`.trim());
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

async function loadReservationAlerts() {
  if (shouldUseApiBackedAlerts()) {
    const payload = await apiRequest("/api/reservation-alerts");
    const parsed = payload?.data;
    return Array.isArray(parsed) ? parsed : [];
  }

  const parsed = await readJsonFile(RESERVATION_ALERTS_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadDisneyVerificationStates() {
  if (!shouldUseApiBackedAlerts()) {
    return [];
  }

  const payload = await apiRequest("/api/reservation-worker/disney-verification");
  const parsed = payload?.data;
  return Array.isArray(parsed) ? parsed : [];
}

async function persistReservationAlerts(alerts) {
  if (shouldUseApiBackedAlerts()) {
    const safeAlerts = Array.isArray(alerts) ? alerts : [];
    const existingAlerts = await loadReservationAlerts();
    const existingIds = new Set(existingAlerts.map(alert => alert.id));
    const nextIds = new Set(safeAlerts.map(alert => alert.id));

    for (const alert of safeAlerts) {
      if (!alert?.id) continue;

      const existing = existingAlerts.find(entry => entry.id === alert.id);
      if (!existing) {
        await apiRequest("/api/reservation-alerts", {
          method: "POST",
          body: JSON.stringify(alert)
        });
        continue;
      }

      await apiRequest(`/api/reservation-alerts/${alert.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          restaurantName: alert.restaurantName,
          partySize: alert.partySize,
          preferredDate: alert.preferredDate,
          startTime: alert.startTime,
          endTime: alert.endTime,
          enabled: alert.enabled,
          status: alert.status,
          lastCheckedAt: alert.lastCheckedAt,
          lastMatchAt: alert.lastMatchAt,
          deviceToken: alert.deviceToken
        })
      });
    }

    for (const existingId of existingIds) {
      if (nextIds.has(existingId)) continue;
      await apiRequest(`/api/reservation-alerts/${existingId}`, {
        method: "DELETE"
      });
    }

    return;
  }

  await writeJsonFile(RESERVATION_ALERTS_FILE, Array.isArray(alerts) ? alerts : []);
}

async function loadReservationQueryCache() {
  const parsed = await readJsonFile(RESERVATION_QUERY_CACHE_FILE, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function persistReservationQueryCache(cache) {
  await writeJsonFile(RESERVATION_QUERY_CACHE_FILE, cache && typeof cache === "object" ? cache : {});
}

function buildReservationQueryKey(alert) {
  const provider = String(alert.provider || "").trim().toLowerCase();
  const restaurantName = String(alert.restaurantName || "").trim().toLowerCase();
  const preferredDate = String(alert.preferredDate || "").trim();
  const partySize = Number(alert.partySize) || 0;
  const startTime = String(alert.startTime || "").trim();
  const endTime = String(alert.endTime || "").trim();

  return [provider, restaurantName, preferredDate, partySize, startTime, endTime].join("::");
}

function groupReservationAlerts(alerts) {
  const grouped = new Map();

  alerts
    .filter(alert => alert && alert.enabled !== false)
    .forEach(alert => {
      const key = buildReservationQueryKey(alert);
      const existing = grouped.get(key);

      if (existing) {
        existing.alerts.push(alert);
        return;
      }

      grouped.set(key, {
        key,
        provider: String(alert.provider || "").trim().toLowerCase(),
        restaurantName: String(alert.restaurantName || "").trim(),
        preferredDate: String(alert.preferredDate || "").trim(),
        partySize: Number(alert.partySize) || 0,
        startTime: String(alert.startTime || "").trim(),
        endTime: String(alert.endTime || "").trim(),
        alerts: [alert]
      });
    });

  return [...grouped.values()];
}

module.exports = {
  RESERVATION_ALERTS_FILE,
  RESERVATION_QUERY_CACHE_FILE,
  loadReservationAlerts,
  loadDisneyVerificationStates,
  persistReservationAlerts,
  loadReservationQueryCache,
  persistReservationQueryCache,
  buildReservationQueryKey,
  groupReservationAlerts
};
