(function () {
  const baseUrl = window.__API_BASE__ || "";
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

  function formatUpdated(lastUpdated) {
    if (!lastUpdated) return "Not loaded yet";

    const parsed = new Date(lastUpdated);
    if (Number.isNaN(parsed.getTime())) return "Unknown";

    return parsed.toLocaleString();
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
      let response = null;
      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(`${baseUrl}/api/alerts`, {
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

      renderAlerts(alerts);
      status.textContent = alerts.length
        ? `${alerts.length} active alert${alerts.length === 1 ? "" : "s"}`
        : "No active alerts right now.";
      scheduleRefresh();
    } catch (error) {
      console.error("Alerts load failed:", error);
      list.innerHTML = `
        <div class="alerts-empty">
          Could not load active alerts right now. Please try again.
        </div>
      `;
      status.textContent = error.message;
      scheduleRefresh(5000);
    }
  }

  function renderAlerts(alerts) {
    const list = document.getElementById("alertsList");

    if (!alerts.length) {
      list.innerHTML = `
        <div class="alerts-empty">
          No active wait time alerts have been saved yet.
        </div>
      `;
      return;
    }

    list.innerHTML = alerts.map(alert => `
      <article class="alert-manager-card" data-alert-id="${alert.id}">
        <div class="alert-manager-head">
          <div>
            <h3>${alert.name}</h3>
            <div class="alert-manager-meta">
              <span class="alert-chip park">${formatParkName(alert.park)}</span>
              <span class="alert-chip ${alert.isTriggered ? "live" : "pending"}">
                ${alert.isTriggered ? "Triggered now" : "Waiting"}
              </span>
              <span class="alert-chip status">${alert.status || "Unknown"}</span>
            </div>
          </div>
        </div>

        <div class="alert-manager-body">
          <div class="alert-stat-grid">
            <div class="alert-stat">
              <span class="alert-stat-label">Alert threshold</span>
              <span class="alert-stat-value">${formatWait(alert.waitTime)}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Current wait</span>
              <span class="alert-stat-value">${formatWait(alert.currentWait)}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Last refresh</span>
              <span class="alert-stat-value">${formatUpdated(alert.lastUpdated)}</span>
            </div>
          </div>

          <div class="alert-manager-actions">
            <div class="alert-input-group">
              <label for="wait-${alert.id}">Update threshold</label>
              <input id="wait-${alert.id}" type="number" min="0" value="${alert.waitTime}" />
            </div>
            <button class="alert-action-btn update" data-action="update">Update</button>
            <button class="alert-action-btn delete" data-action="delete">Delete</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  async function updateAlert(alertId, waitTime) {
    const response = await fetch(`${baseUrl}/api/alerts/${alertId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ waitTime })
    });

    if (!response.ok) {
      throw new Error(`Failed to update alert (${response.status})`);
    }
  }

  async function deleteAlert(alertId) {
    const response = await fetch(`${baseUrl}/api/alerts/${alertId}`, {
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
  }

  function closeDeleteModal() {
    pendingDeleteAlert = null;
    document.getElementById("deleteAlertModal")?.classList.remove("open");
  }

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
        const waitTime = Number(input.value);
        if (!Number.isFinite(waitTime) || waitTime < 0) {
          throw new Error("Enter a valid wait time.");
        }

        status.textContent = "Updating alert...";
        await updateAlert(alertId, waitTime);
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

    loadAlerts();
  });
})();
