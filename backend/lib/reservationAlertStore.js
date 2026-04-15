const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const RESERVATION_ALERTS_FILE = path.join(DATA_DIR, "reservation-alerts.json");
const RESERVATION_QUERY_CACHE_FILE = path.join(DATA_DIR, "reservation-query-cache.json");

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

async function loadReservationAlerts() {
  const parsed = await readJsonFile(RESERVATION_ALERTS_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
}

async function persistReservationAlerts(alerts) {
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
  persistReservationAlerts,
  loadReservationQueryCache,
  persistReservationQueryCache,
  buildReservationQueryKey,
  groupReservationAlerts
};
