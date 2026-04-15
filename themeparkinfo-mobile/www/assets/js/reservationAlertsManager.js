(function () {
  const baseUrl = window.__API_BASE__ || "";
  const OWNER_KEY_STORAGE = "reservationAlertOwnerKey";
  const PUSH_TOKEN_STORAGE = "pushDeviceToken";
  const RESTAURANT_OPTIONS = {
    wdw: [
      "Be Our Guest Restaurant",
      "Cinderella's Royal Table",
      "Chef Mickey's",
      "California Grill",
      "Topolino's Terrace - Flavors of the Riviera",
      "Space 220 Restaurant",
      "Space 220 Lounge",
      "Le Cellier Steakhouse",
      "Via Napoli Ristorante e Pizzeria",
      "Biergarten Restaurant",
      "Sci-Fi Dine-In Theater Restaurant",
      "50's Prime Time Cafe",
      "Hollywood Brown Derby",
      "Roundup Rodeo BBQ",
      "Oga's Cantina",
      "Tusker House Restaurant",
      "Yak & Yeti Restaurant",
      "Tiffins Restaurant",
      "Boma - Flavors of Africa",
      "Sanaa",
      "Story Book Dining at Artist Point with Snow White",
      "Ohana",
      "Cape May Cafe"
    ],
    disneyland: [
      "Blue Bayou Restaurant",
      "Cafe Orleans",
      "Carnation Cafe",
      "River Belle Terrace",
      "Plaza Inn",
      "Lamplight Lounge",
      "Lamplight Lounge - Boardwalk Dining",
      "Carthay Circle Restaurant",
      "Wine Country Trattoria",
      "Magic Key Terrace",
      "Naples Ristorante e Bar",
      "Catal Restaurant",
      "Uva Bar & Cafe",
      "Storytellers Cafe",
      "Goofy's Kitchen",
      "Palm Breeze Bar",
      "Hearthstone Lounge"
    ],
    usorlando: [
      "Mythos Restaurant",
      "Confisco Grille",
      "Lombard's Seafood Grille",
      "Finnegan's Bar & Grill",
      "The Kitchen",
      "Bigfire",
      "Antojitos Authentic Mexican Food",
      "Cowfish Sushi Burger Bar",
      "NBC Sports Grill & Brew",
      "Toothsome Chocolate Emporium & Savory Feast Kitchen",
      "Vivo Italian Kitchen",
      "Pat O'Brien's",
      "Jake's American Bar",
      "Mama Della's Ristorante",
      "Bice Ristorante",
      "Amatista Cookhouse"
    ],
    hollywood: [
      "Toadstool Cafe",
      "Antojitos Cocina Mexicana",
      "The Three Broomsticks",
      "Krusty Burger Patio",
      "Saddle Ranch Chop House CityWalk",
      "Jimmy Buffett's Margaritaville",
      "Voodoo Doughnut CityWalk",
      "Buca di Beppo CityWalk"
    ]
  };
  let refreshTimerId = null;
  let pendingDeleteAlert = null;

  function getOwnerKey() {
    let ownerKey = localStorage.getItem(OWNER_KEY_STORAGE);

    if (!ownerKey) {
      ownerKey = `owner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(OWNER_KEY_STORAGE, ownerKey);
    }

    return ownerKey;
  }

  function getPushToken() {
    return localStorage.getItem(PUSH_TOKEN_STORAGE) || "";
  }

  function getRestaurantSelect() {
    return document.getElementById("reservationRestaurantName");
  }

  function populateRestaurantOptions(provider, selectedValue = "") {
    const select = getRestaurantSelect();
    if (!select) return;

    const options = RESTAURANT_OPTIONS[String(provider || "").toLowerCase()] || [];
    const resolvedValue = options.includes(selectedValue) ? selectedValue : "";

    select.innerHTML = [
      '<option value="">Choose a restaurant</option>',
      ...options.map(name => `<option value="${name}">${name}</option>`)
    ].join("");

    select.value = resolvedValue;
  }

  function formatProvider(provider) {
    const labels = {
      wdw: "Walt Disney World",
      disneyland: "Disneyland Resort",
      usorlando: "Universal Orlando",
      hollywood: "Universal Hollywood"
    };

    return labels[String(provider || "").toLowerCase()] || provider || "Unknown";
  }

  function formatDate(value) {
    if (!value) return "Not set";
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }

  function formatChecked(value) {
    if (!value) return "Not checked yet";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function scheduleRefresh(delayMs = 15000) {
    clearTimeout(refreshTimerId);
    refreshTimerId = setTimeout(() => loadReservationAlerts({ silent: true }), delayMs);
  }

  async function loadReservationAlerts(options = {}) {
    const { silent = false } = options;
    const status = document.getElementById("reservationAlertsStatus");
    const list = document.getElementById("reservationAlertsList");

    if (!silent) {
      status.textContent = "Loading restaurant alerts...";
    }

    try {
      const response = await fetch(`${baseUrl}/api/reservation-alerts?ownerKey=${encodeURIComponent(getOwnerKey())}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Failed to load restaurant alerts (${response.status})`);
      }

      const payload = await response.json();
      const alerts = Array.isArray(payload.data) ? payload.data : [];
      renderReservationAlerts(alerts);
      status.textContent = alerts.length
        ? `${alerts.length} restaurant alert${alerts.length === 1 ? "" : "s"} saved`
        : "No restaurant alerts saved yet.";
      scheduleRefresh();
    } catch (error) {
      console.error("Restaurant alerts load failed:", error);
      list.innerHTML = `<div class="alerts-empty">Could not load restaurant alerts right now.</div>`;
      status.textContent = error.message;
      scheduleRefresh(5000);
    }
  }

  function renderReservationAlerts(alerts) {
    const list = document.getElementById("reservationAlertsList");

    if (!alerts.length) {
      list.innerHTML = `
        <div class="alerts-empty">
          No restaurant alerts saved yet.
        </div>
      `;
      return;
    }

    list.innerHTML = alerts.map(alert => `
      <article class="alert-manager-card" data-reservation-alert-id="${alert.id}">
        <div class="alert-manager-head">
          <div>
            <div class="alert-title-row">
              <h3>${alert.restaurantName}</h3>
              <span class="alert-chip ${alert.enabled ? "pending" : "park"}">
                ${alert.enabled ? "Watching" : "Paused"}
              </span>
            </div>
            <div class="alert-manager-meta">
              <span class="alert-chip park">${formatProvider(alert.provider)}</span>
              <span class="alert-chip status">${alert.partySize} ${alert.partySize === 1 ? "guest" : "guests"}</span>
            </div>
          </div>
        </div>

        <div class="alert-manager-body">
          <div class="reservation-card-grid">
            <div class="alert-stat">
              <span class="alert-stat-label">Date</span>
              <span class="alert-stat-value small">${formatDate(alert.preferredDate)}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Time window</span>
              <span class="alert-stat-value small">${alert.startTime} - ${alert.endTime}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Status</span>
              <span class="alert-stat-value small">${alert.status || "watching"}</span>
            </div>
            <div class="alert-stat">
              <span class="alert-stat-label">Last checked</span>
              <span class="alert-stat-value small">${formatChecked(alert.lastCheckedAt)}</span>
            </div>
          </div>

          <div class="reservation-status-banner">
            This restaurant watch is saved separately from ride alerts and ready for reservation checking.
          </div>

          <div class="alert-manager-actions">
            <div class="alert-input-group">
              <label for="party-${alert.id}">Party size</label>
              <input id="party-${alert.id}" type="number" min="1" value="${alert.partySize}" />
            </div>
            <div class="alert-input-group">
              <label for="start-${alert.id}">Start time</label>
              <input id="start-${alert.id}" type="time" value="${alert.startTime}" />
            </div>
            <div class="alert-input-group">
              <label for="end-${alert.id}">End time</label>
              <input id="end-${alert.id}" type="time" value="${alert.endTime}" />
            </div>
            <button class="alert-action-btn update" data-action="toggle-enabled">
              ${alert.enabled ? "Pause" : "Resume"}
            </button>
            <button class="alert-action-btn update" data-action="update">Update</button>
            <button class="alert-action-btn delete" data-action="delete">Delete</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  async function saveReservationAlert(payload) {
    const response = await fetch(`${baseUrl}/api/reservation-alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to save restaurant alert (${response.status})`);
    }
  }

  async function updateReservationAlert(alertId, payload) {
    const response = await fetch(`${baseUrl}/api/reservation-alerts/${alertId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to update restaurant alert (${response.status})`);
    }
  }

  async function deleteReservationAlert(alertId) {
    const response = await fetch(`${baseUrl}/api/reservation-alerts/${alertId}?ownerKey=${encodeURIComponent(getOwnerKey())}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error(`Failed to delete restaurant alert (${response.status})`);
    }
  }

  function openDeleteModal(alertId, restaurantName) {
    pendingDeleteAlert = { id: alertId, name: restaurantName };
    document.getElementById("deleteReservationAlertText").textContent = `Delete the restaurant alert for ${restaurantName}?`;
    document.getElementById("deleteReservationAlertModal")?.classList.add("open");
  }

  function closeDeleteModal() {
    pendingDeleteAlert = null;
    document.getElementById("deleteReservationAlertModal")?.classList.remove("open");
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const card = button.closest("[data-reservation-alert-id]");
    if (!card) return;

    const alertId = card.dataset.reservationAlertId;
    const status = document.getElementById("reservationAlertsStatus");

    try {
      button.disabled = true;

      if (button.dataset.action === "delete") {
        const title = card.querySelector("h3")?.textContent || "this restaurant alert";
        openDeleteModal(alertId, title);
        button.disabled = false;
        return;
      }

      if (button.dataset.action === "toggle-enabled") {
        const enabled = button.textContent.trim().toLowerCase() !== "resume";
        status.textContent = enabled ? "Pausing restaurant alert..." : "Resuming restaurant alert...";
        await updateReservationAlert(alertId, {
          ownerKey: getOwnerKey(),
          enabled: !enabled
        });
        await loadReservationAlerts();
        return;
      }

      status.textContent = "Updating restaurant alert...";
      await updateReservationAlert(alertId, {
        ownerKey: getOwnerKey(),
        partySize: Number(card.querySelector(`#party-${alertId}`)?.value),
        startTime: card.querySelector(`#start-${alertId}`)?.value,
        endTime: card.querySelector(`#end-${alertId}`)?.value
      });
      await loadReservationAlerts();
    } catch (error) {
      console.error("Restaurant alert action failed:", error);
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const providerSelect = document.getElementById("reservationProvider");
    providerSelect?.addEventListener("change", event => {
      populateRestaurantOptions(event.target.value);
    });

    document.getElementById("reservationAlertForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const status = document.getElementById("reservationAlertsStatus");

      try {
        status.textContent = "Saving restaurant alert...";
        await saveReservationAlert({
          provider: providerSelect.value,
          restaurantName: getRestaurantSelect().value,
          partySize: Number(document.getElementById("reservationPartySize").value),
          preferredDate: document.getElementById("reservationDate").value,
          startTime: document.getElementById("reservationStartTime").value,
          endTime: document.getElementById("reservationEndTime").value,
          ownerKey: getOwnerKey(),
          deviceToken: getPushToken()
        });

        event.target.reset();
        providerSelect.value = "wdw";
        populateRestaurantOptions(providerSelect.value);
        document.getElementById("reservationPartySize").value = 2;
        await loadReservationAlerts();
      } catch (error) {
        console.error("Save restaurant alert failed:", error);
        status.textContent = error.message;
      }
    });

    document.getElementById("refreshReservationAlertsBtn")?.addEventListener("click", () => loadReservationAlerts());
    document.getElementById("cancelDeleteReservationAlertBtn")?.addEventListener("click", closeDeleteModal);

    document.getElementById("confirmDeleteReservationAlertBtn")?.addEventListener("click", async () => {
      if (!pendingDeleteAlert) return;

      const status = document.getElementById("reservationAlertsStatus");
      status.textContent = "Deleting restaurant alert...";

      try {
        await deleteReservationAlert(pendingDeleteAlert.id);
        closeDeleteModal();
        await loadReservationAlerts();
      } catch (error) {
        console.error("Delete restaurant alert failed:", error);
        status.textContent = error.message;
      }
    });

    document.getElementById("deleteReservationAlertModal")?.addEventListener("click", event => {
      if (event.target.id === "deleteReservationAlertModal") {
        closeDeleteModal();
      }
    });

    populateRestaurantOptions(providerSelect?.value || "wdw");
    loadReservationAlerts();
  });
})();
