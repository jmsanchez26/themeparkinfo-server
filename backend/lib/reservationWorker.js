const {
  loadReservationAlerts,
  persistReservationAlerts,
  loadReservationQueryCache,
  persistReservationQueryCache,
  buildReservationQueryKey,
  groupReservationAlerts
} = require("./reservationAlertStore");
const { sendReservationNotifications } = require("./reservationNotifier");
const { checkDisneyDiningAvailability } = require("../providers/disneyDiningChecker");
const { checkUniversalDiningAvailability } = require("../providers/universalDiningChecker");

const RESERVATION_CHECK_INTERVAL_MS = Number(process.env.RESERVATION_CHECK_INTERVAL_MS || 15 * 60 * 1000);
const RESERVATION_NOTIFICATION_COOLDOWN_MS = Number(process.env.RESERVATION_NOTIFICATION_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const RESERVATION_WORKER_CONCURRENCY = Math.max(1, Number(process.env.RESERVATION_WORKER_CONCURRENCY || 3));

function getProviderChecker(provider) {
  if (provider === "wdw" || provider === "disneyland") {
    return checkDisneyDiningAvailability;
  }

  if (provider === "usorlando" || provider === "hollywood") {
    return checkUniversalDiningAvailability;
  }

  return null;
}

function toIsoStringOrNull(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function shouldNotify(cacheEntry, nowMs) {
  const lastNotifiedMs = cacheEntry?.lastNotifiedAt ? new Date(cacheEntry.lastNotifiedAt).getTime() : 0;
  return !lastNotifiedMs || nowMs - lastNotifiedMs >= RESERVATION_NOTIFICATION_COOLDOWN_MS;
}

function createMatchRecord(group, match) {
  return {
    restaurant: match.restaurant || group.restaurantName,
    date: match.date || group.preferredDate,
    time: match.time || group.startTime,
    partySize: group.partySize
  };
}

async function processReservationBatch(groups, checkQuery) {
  const results = [];

  for (let index = 0; index < groups.length; index += RESERVATION_WORKER_CONCURRENCY) {
    const batch = groups.slice(index, index + RESERVATION_WORKER_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkQuery));
    results.push(...batchResults);
  }

  return results;
}

async function runReservationWorkerCycle({ messaging, log = console } = {}) {
  const allAlerts = await loadReservationAlerts();
  const enabledAlerts = allAlerts.filter(alert => alert && alert.enabled !== false);
  const groupedQueries = groupReservationAlerts(enabledAlerts);
  const queryCache = await loadReservationQueryCache();
  const notifications = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  if (!groupedQueries.length) {
    log.log("Reservation worker: no enabled alerts to check.");
    return {
      checkedQueries: 0,
      sentNotifications: 0,
      matchedQueries: 0
    };
  }

  const batchResults = await processReservationBatch(groupedQueries, async group => {
    const checker = getProviderChecker(group.provider);

    if (!checker) {
      return {
        group,
        result: {
          available: false,
          matches: [],
          source: "unsupported-provider"
        }
      };
    }

    try {
      const result = await checker({
        provider: group.provider,
        restaurantName: group.restaurantName,
        preferredDate: group.preferredDate,
        partySize: group.partySize,
        startTime: group.startTime,
        endTime: group.endTime
      });

      return { group, result };
    } catch (error) {
      log.error(`Reservation worker check failed for ${group.restaurantName}:`, error.message);
      return {
        group,
        result: {
          available: false,
          matches: [],
          source: "error",
          error: error.message
        }
      };
    }
  });

  let matchedQueries = 0;

  batchResults.forEach(({ group, result }) => {
    const cacheKey = buildReservationQueryKey(group);
    const cacheEntry = queryCache[cacheKey] || {};
    const matches = Array.isArray(result?.matches) ? result.matches : [];
    const available = Boolean(result?.available) && matches.length > 0;

    queryCache[cacheKey] = {
      available,
      lastCheckedAt: nowIso,
      lastMatchAt: available ? nowIso : cacheEntry.lastMatchAt || null,
      lastNotifiedAt: cacheEntry.lastNotifiedAt || null,
      source: result?.source || "unknown",
      lastError: result?.error || null,
      matches
    };

    if (!available && (result?.error || result?.note)) {
      log.log(
        `Reservation worker detail for ${group.restaurantName} (${group.preferredDate} ${group.startTime}-${group.endTime}): ${result.error || result.note}`
      );
    }

    if (!available) {
      return;
    }

    matchedQueries += 1;

    if (!shouldNotify(cacheEntry, nowMs)) {
      return;
    }

    const firstMatch = createMatchRecord(group, matches[0] || {});
    group.alerts.forEach(alert => {
      if (!alert.deviceToken) return;

      notifications.push({
        alertId: alert.id,
        deviceToken: alert.deviceToken,
        provider: group.provider,
        match: firstMatch
      });
    });

    queryCache[cacheKey].lastNotifiedAt = nowIso;
  });

  const sendResult = await sendReservationNotifications(messaging, notifications);

  const updatedAlerts = allAlerts.map(alert => {
    const cacheKey = buildReservationQueryKey(alert);
    const cacheEntry = queryCache[cacheKey];

    if (!cacheEntry) {
      return alert;
    }

    return {
      ...alert,
      status: cacheEntry.available ? "available" : "watching",
      lastCheckedAt: toIsoStringOrNull(cacheEntry.lastCheckedAt) || alert.lastCheckedAt || null,
      lastMatchAt: cacheEntry.lastMatchAt || alert.lastMatchAt || null
    };
  }).filter(alert => !sendResult.invalidTokens.includes(alert.deviceToken));

  await persistReservationAlerts(updatedAlerts);
  await persistReservationQueryCache(queryCache);

  return {
    checkedQueries: groupedQueries.length,
    sentNotifications: sendResult.sent,
    matchedQueries
  };
}

function startReservationWorker({ messaging, log = console } = {}) {
  let isRunning = false;

  async function runCycle() {
    if (isRunning) {
      log.log("Reservation worker: skipping run because a previous cycle is still active.");
      return;
    }

    isRunning = true;
    try {
      const result = await runReservationWorkerCycle({ messaging, log });
      log.log(
        `Reservation worker: checked ${result.checkedQueries} grouped queries, matched ${result.matchedQueries}, sent ${result.sentNotifications} notifications.`
      );
    } catch (error) {
      log.error("Reservation worker cycle failed:", error);
    } finally {
      isRunning = false;
    }
  }

  runCycle().catch(error => {
    log.error("Reservation worker initial cycle failed:", error);
  });

  return setInterval(() => {
    runCycle().catch(error => {
      log.error("Reservation worker scheduled cycle failed:", error);
    });
  }, RESERVATION_CHECK_INTERVAL_MS);
}

module.exports = {
  RESERVATION_CHECK_INTERVAL_MS,
  runReservationWorkerCycle,
  startReservationWorker
};
