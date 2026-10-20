(function () {
  const baseUrl = window.__API_BASE__ || "";
  const isNative = window.Capacitor?.getPlatform?.() === "android";
  function readLocalAlerts() {
    const alerts = JSON.parse(localStorage.getItem("waitTimeAlerts") || "[]");
    return Array.isArray(alerts) ? alerts : [];
  }
  function writeLocalAlerts(alerts) {
    localStorage.setItem("waitTimeAlerts", JSON.stringify(alerts));
  }
  function localAlertId(alert, index) {
    return alert.id || "local-" + index;
  }
  function changeLocalAlert(alertId, waitTime, mode) {
    const alerts = readLocalAlerts();
    const index = alerts.findIndex((alert, index) => localAlertId(alert, index) === alertId);
    if (index < 0) throw new Error("Alert no longer exists. Refresh and try again.");
    if (waitTime === undefined) alerts.splice(index, 1);
    else {
      alerts[index].waitTime = waitTime;
      alerts[index].mode = mode;
      delete alerts[index].triggeredAt;
    }
    writeLocalAlerts(alerts);
  }
  let alertsRefreshTimerId = null;
  let pendingDeleteAlert = null;

  function formatParkName(park) {
    const labels = {
      wdw: "Walt Disney World",
      disneyland: "Disneyland Resort",
      usorlando: "Universal Orlando",
      hollywood: "Universal Hollywood"
    };

    return labels[String(park || "").toLowerCase()] || park || "Unknown";
  }

  function formatWait(waitTime) {
    return typeof waitTime === "number" ? `${waitTime} min` : "N/A";
  }

  function formatAlertTimestamp(timestamp, park, missingLabel, invalidLabel) {
    if (!timestamp) return missingLabel;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return invalidLabel;
    const zones = {
      wdw: "America/New_York", usorlando: "America/New_York",
      disneyland: "America/Los_Angeles", hollywood: "America/Los_Angeles",
      ushollywood: "America/Los_Angeles"
    };
    const zone = zones[String(park || "").toLowerCase()];
    if (!zone) return "Unknown park timezone";
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: zone, timeZoneName: "short"
    }).format(date);
  }

  function formatUpdated(lastUpdated, park) {
    return formatAlertTimestamp(lastUpdated, park, "Not loaded yet", "Unknown");
  }

  function formatTriggered(triggeredAt, park) {
    return formatAlertTimestamp(triggeredAt, park, "Not triggered yet", "Triggered recently");
  }

  async function loadLocalAlertSnapshots() {
    if (window.BrowserAlerts) await window.BrowserAlerts.check();
    const parks = ["wdw", "disneyland", "usorlando", "hollywood"];
    const saved = readLocalAlerts();
    if (!saved.length) return [];
    const normalize = park => String(park || "").toLowerCase() === "ushollywood" ? "hollywood" : String(park || "").toLowerCase();
    const requested = saved.some(alert => !parks.includes(normalize(alert.park)))
      ? parks : [...new Set(saved.map(alert => normalize(alert.park)))];
    const results = await Promise.all(requested.map(async park => {
      try {
        const response = await fetch(baseUrl + "/api/" + park, { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Park data unavailable");
        const payload = await response.json();
        if (!Array.isArray(payload.data?.liveData)) throw new Error("Invalid park data");
        return { park, rides: payload.data.liveData, lastUpdated: payload.lastUpdated || new Date().toISOString() };
      } catch { return { park, rides: [], lastUpdated: null }; }
    }));
    // Re-read after the fetch so updates/deletions in another tab are respected.
    const current = readLocalAlerts();
    let changed = false;
    const snapshots = current.map((alert, index) => {
      const candidates = results.flatMap(result => {
        if (alert.park && result.park !== normalize(alert.park)) return [];
        return result.rides.filter(ride => ride.entityType === "ATTRACTION" &&
          (alert.rideId ? ride.id === alert.rideId : ride.name === alert.name))
          .map(ride => ({ ...result, ride }));
      });
      const match = candidates.length === 1 ? candidates[0] : null;
      if (!match) return { ...alert, id: localAlertId(alert, index), status: "Live data unavailable", currentWait: null,
        lastUpdated: null, isTriggered: Boolean(alert.triggeredAt) };
      if (alert.park !== match.park || alert.rideId !== match.ride.id) {
        alert.park = match.park; alert.rideId = match.ride.id; changed = true;
      }
      const evaluated = window.AlertRules.evaluate(alert, match.ride);
      if (!window.BrowserAlerts && evaluated.isTriggered && (alert.mode === "good_time" || !alert.triggeredAt)) {
        alert.triggeredAt = new Date().toISOString(); changed = true;
      }
      const observed = window.AlertRules.observation(match.ride);
      if (!window.BrowserAlerts && alert.lastObservedWait !== observed) { alert.lastObservedWait = observed; changed = true; }
      return { ...alert, ...evaluated, id: localAlertId(alert, index), lastUpdated: match.lastUpdated,
        isTriggered: alert.mode === "good_time" ? evaluated.isTriggered : Boolean(alert.triggeredAt) };
    });
    if (changed) writeLocalAlerts(current);
    return snapshots;
  }

  function scheduleRefresh(delayMs = 15000) {
    clearTimeout(alertsRefreshTimerId);
    alertsRefreshTimerId = setTimeout(() => {
      loadAlerts({ silent: true });
    }, delayMs);
  }

  async function loadAlerts(options = {}) {
    const { silent = false } = options;
    const status = document.getElementById("alertsStatus");
    const list = document.getElementById("alertsList");

    if (!silent) {
      status.textContent = "Loading alerts...";
    }

    try {
      if (!isNative) {
        const alerts = await loadLocalAlertSnapshots();
        renderAlerts(alerts);
        status.textContent = alerts.length
          ? alerts.length + " saved alert" + (alerts.length === 1 ? "" : "s")
          : "No wait time alerts saved yet.";
        scheduleRefresh();
        return;
      }
      let response = null;
      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await window.AlertSecurity.request("/api/alerts", {
            cache: "no-store"
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        }
      }

      if (!response) {
        throw lastError || new Error("Failed to load alerts");
      }

      if (!response.ok) {
        throw new Error(`Failed to load alerts (${response.status})`);
      }

      const payload = await response.json();
      const alerts = Array.isArray(payload.data) ? payload.data : [];
      const triggeredCount = alerts.filter(alert => alert.isTriggered).length;

      renderAlerts(alerts);
      status.textContent = alerts.length
        ? `${alerts.length} saved alert${alerts.length === 1 ? "" : "s"}${triggeredCount ? `, ${triggeredCount} already hit` : ""}`
        : "No wait time alerts saved yet.";
      scheduleRefresh();
    } catch (error) {
      console.error("Alerts load failed:", error);
      list.innerHTML = window.SafeHTML.sanitize(`
        <div class="alerts-empty">
          Could not load your alerts right now. Please try again.
        </div>
      `);
      status.textContent = error.message;
      scheduleRefresh(5000);
    }
  }

  function renderAlerts(alerts) {
    const list = document.getElementById("alertsList");

    if (!alerts.length) {
      list.innerHTML = window.SafeHTML.sanitize(`
        <div class="alerts-empty">
          No wait time alerts have been saved yet.
        </div>
      `);
      return;
    }

    list.innerHTML = window.SafeHTML.sanitize(alerts.map(alert => `
      <article class="alert-manager-card ${alert.isTriggered ? "is-hit" : ""}" data-alert-id="${alert.id}">
        <div class="alert-manager-head">
          <div>
            <div class="alert-title-row">
              <h3>${window.SafeHTML.text(alert.name)}</h3>
              <span class="alert-chip ${alert.isTriggered ? "live" : "pending"}">
                ${alert.mode === "good_time" ? "Watching drops" : alert.isTriggered ? "Alert hit" : "Watching"}
              </span>
            </div>
            <div class="alert-manager-meta">
              <span class="alert-chip park">${formatParkName(alert.park)}</span>
              <span class="alert-chip status">${alert.status || "Unknown"}</span>
            </div>
          </div>
        </div>

        <div class="alert-manager-body">
          <div class="alert-stat-grid">
            <div class="alert-stat">
              <span class="alert-stat-label">Alert type</span>
              <span class="alert-stat-value">${alert.mode === "good_time" ? "Wait drops + good time to ride" : formatWait(alert.waitTime)}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Current wait</span>
              <span class="alert-stat-value">${formatWait(alert.currentWait)}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">${alert.mode === "good_time" && alert.triggeredAt ? "Last good-time alert" : alert.isTriggered ? "Alert hit" : "Last refresh"}</span>
              <span class="alert-stat-value">${(alert.mode === "good_time" && alert.triggeredAt) || alert.isTriggered ? formatTriggered(alert.triggeredAt, alert.park) : formatUpdated(alert.lastUpdated, alert.park)}</span>
            </div>
          </div>

          ${alert.mode === "good_time" && alert.isTriggered ? `
            <div class="alert-hit-banner">The wait dropped and it is a good time to ride! This alert will keep watching for new drops.</div>
          ` : alert.isTriggered ? `
            <div class="alert-hit-banner">
              This alert was already hit. It stays here until you update it or delete it.
            </div>
          ` : ""}

          <div class="alert-manager-actions">
            <div class="alert-input-group">
              <label for="mode-${alert.id}">Alert type</label>
              <select id="mode-${alert.id}" class="alert-mode-select">
                <option value="threshold" ${alert.mode !== "good_time" ? "selected" : ""}>Set a wait time</option>
                <option value="good_time" ${alert.mode === "good_time" ? "selected" : ""}>Tell me when is the best time</option>
              </select>
              <small class="alert-threshold-help" ${alert.mode === "good_time" ? "hidden" : ""}>Alerts you when the wait reaches your chosen time or drops below it.</small>
              <label for="wait-${alert.id}" class="threshold-label" ${alert.mode === "good_time" ? "hidden" : ""}>Wait time (minutes)</label>
              <input id="wait-${alert.id}" type="number" min="0" max="300" value="${alert.waitTime ?? ""}" ${alert.mode === "good_time" ? "hidden" : ""} />
            </div>
            <button class="alert-action-btn update" data-action="update">Update</button>
            <button class="alert-action-btn delete" data-action="delete">Delete</button>
          </div>
        </div>
      </article>
    `).join(""));
  }

  async function updateAlert(alertId, waitTime, mode) {
    if (!isNative) return changeLocalAlert(alertId, waitTime, mode);
    const response = await window.AlertSecurity.request(`/api/alerts/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ waitTime, mode })
    });

    if (!response.ok) {
      throw new Error(`Failed to update alert (${response.status})`);
    }
  }

  async function deleteAlert(alertId) {
    if (!isNative) return changeLocalAlert(alertId);
    const response = await window.AlertSecurity.request(`/api/alerts/${encodeURIComponent(alertId)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error(`Failed to delete alert (${response.status})`);
    }
  }

  function openDeleteModal(alertId, alertName) {
    pendingDeleteAlert = { id: alertId, name: alertName };

    const modal = document.getElementById("deleteAlertModal");
    const text = document.getElementById("deleteAlertText");
    if (!modal || !text) return;

    text.textContent = `Delete the alert for ${alertName}? This cannot be undone.`;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeDeleteModal() {
    pendingDeleteAlert = null;
    const modal = document.getElementById("deleteAlertModal");
    modal?.classList.remove("open");
    modal?.setAttribute("aria-hidden", "true");
  }

  document.addEventListener("change", event => {
    if (!event.target.matches(".alert-mode-select")) return;
    const card = event.target.closest("[data-alert-id]");
    const smart = event.target.value === "good_time";
    card.querySelector("input[type='number']").hidden = smart;
    card.querySelector(".threshold-label").hidden = smart;
    card.querySelector(".alert-threshold-help").hidden = smart;
  });

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const card = button.closest("[data-alert-id]");
    if (!card) return;

    const alertId = card.dataset.alertId;
    const action = button.dataset.action;
    const input = card.querySelector("input[type='number']");
    const status = document.getElementById("alertsStatus");

    try {
      button.disabled = true;

      if (action === "update") {
        const mode = card.querySelector(".alert-mode-select").value;
        const waitTime = mode === "good_time" ? null : Number(input.value);
        if (mode === "threshold" && (!input.value.trim() || !Number.isInteger(waitTime) || waitTime < 0 || waitTime > 300)) {
          throw new Error("Enter a valid wait time.");
        }

        status.textContent = "Updating alert...";
        await updateAlert(alertId, waitTime, mode);
      }

      if (action === "delete") {
        const title = card.querySelector("h3")?.textContent || "this alert";
        openDeleteModal(alertId, title);
        button.disabled = false;
        return;
      }

      await loadAlerts();
    } catch (error) {
      console.error("Alert action failed:", error);
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const refreshButton = document.getElementById("refreshAlertsBtn");
    if (refreshButton) {
      refreshButton.addEventListener("click", loadAlerts);
    }

    document.getElementById("cancelDeleteAlertBtn")?.addEventListener("click", closeDeleteModal);

    document.getElementById("confirmDeleteAlertBtn")?.addEventListener("click", async () => {
      if (!pendingDeleteAlert) return;

      const status = document.getElementById("alertsStatus");
      status.textContent = "Deleting alert...";

      try {
        await deleteAlert(pendingDeleteAlert.id);
        closeDeleteModal();
        await loadAlerts();
      } catch (error) {
        console.error("Delete failed:", error);
        status.textContent = error.message;
      }
    });

    document.getElementById("deleteAlertModal")?.addEventListener("click", event => {
      if (event.target.id === "deleteAlertModal") {
        closeDeleteModal();
      }
    });

    if (!isNative) window.addEventListener("storage", () => loadAlerts());
    document.getElementById("deleteAllAlertsBtn")?.addEventListener("click", async () => {
      if (!window.confirm("Delete all your alerts and remove this device from push notifications?")) return;
      try {
        if (isNative) await window.AlertSecurity.deleteAll();
        else localStorage.removeItem("waitTimeAlerts");
        await loadAlerts();
      } catch (error) { document.getElementById("alertsStatus").textContent = error.message; }
    });
    if (window.Capacitor?.getPlatform?.() === "ios") {
      document.getElementById("alertPrivacyNote").textContent = "Alerts stay on this iPhone. They are checked while a park page is open; background push is not available yet.";
    }
    loadAlerts();
  });
})();
