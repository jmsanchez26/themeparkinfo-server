

/*************************
 * ALERT MODAL
 *************************/
const isNativeApp =
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === "function" &&
  window.Capacitor.isNativePlatform();

const pushNotifications = window.Capacitor?.Plugins?.PushNotifications;
const localNotifications = window.Capacitor?.Plugins?.LocalNotifications;
const appPlugin = window.Capacitor?.Plugins?.App;
const FOREGROUND_ALERT_CHANNEL_ID = "foreground-wait-alerts";
const ALERTS_PAGE_PATH = "/pages/alerts.html";

const pushRegistrationState = {
  token: null,
  pending: null,
  listenersAttached: false
};

function canUseServerSidePush() {
  return Boolean(isNativeApp && window.Capacitor.getPlatform() === "android" && window.__API_BASE__ && pushNotifications);
}

function getStoredPushToken() {
  try {
    return localStorage.getItem("pushDeviceToken");
  } catch (error) {
    return null;
  }
}

function storePushToken(token) {
  pushRegistrationState.token = token;

  try {
    localStorage.setItem("pushDeviceToken", token);
  } catch (error) {
    console.warn("Could not persist push token:", error);
  }
}

function navigateToAlertsPage() {
  const currentPath = window.location.pathname || "";
  if (currentPath === ALERTS_PAGE_PATH) return;

  window.location.href = ALERTS_PAGE_PATH;
}

function resolveNotificationTarget(data = {}) {
  if (!data || typeof data !== "object") return null;

  const targetPath = data.targetPath || data.path || data.route;
  if (targetPath === ALERTS_PAGE_PATH) {
    return ALERTS_PAGE_PATH;
  }

  return null;
}

async function attachPushListeners() {
  if (!canUseServerSidePush() || pushRegistrationState.listenersAttached) return;

  await pushNotifications.addListener("registration", token => {
    storePushToken(token.value);
  });

  await pushNotifications.addListener("registrationError", error => {
    console.error("Push registration failed:", error);
  });

  await pushNotifications.addListener("pushNotificationReceived", async notification => {
    if (!localNotifications || notification.data?.source === "device-verification") return;

    try {
      const permission = await localNotifications.requestPermissions();
      if (permission.display !== "granted") return;

      const title = notification.title || "ThemeParkInfo alert";
      const body = notification.body || "A wait time alert was triggered.";

      await localNotifications.schedule({
        notifications: [
          {
            id: Date.now(),
            title,
            body,
            channelId: FOREGROUND_ALERT_CHANNEL_ID,
            extra: {
              targetPath: resolveNotificationTarget(notification.data) || ALERTS_PAGE_PATH
            },
            schedule: { at: new Date(Date.now() + 250) }
          }
        ]
      });
    } catch (error) {
      console.error("Foreground notification display failed:", error);
    }
  });

  await pushNotifications.addListener("pushNotificationActionPerformed", event => {
    if (resolveNotificationTarget(event.notification?.data) === ALERTS_PAGE_PATH) {
      navigateToAlertsPage();
    }
  });

  if (localNotifications?.addListener) {
    await localNotifications.addListener("localNotificationActionPerformed", event => {
      if (resolveNotificationTarget(event.notification?.extra) === ALERTS_PAGE_PATH) {
        navigateToAlertsPage();
      }
    });
  }

  if (appPlugin?.addListener) {
    await appPlugin.addListener("appUrlOpen", event => {
      if (typeof event?.url === "string" && event.url.includes("themeparkinfo://alerts")) {
        navigateToAlertsPage();
      }
    });
  }

  pushRegistrationState.listenersAttached = true;
}

async function initializePushNotifications() {
  if (!canUseServerSidePush()) return null;

  if (localNotifications?.createChannel) {
    try {
      await localNotifications.createChannel({
        id: FOREGROUND_ALERT_CHANNEL_ID,
        name: "Foreground Wait Alerts",
        description: "Shows wait time alerts while the app is open.",
        importance: 5,
        visibility: 0
      });
    } catch (error) {
      console.warn("Could not create local notification channel:", error);
    }
  }

  return ensurePushToken();
}

async function ensurePushToken() {
  if (!canUseServerSidePush()) return null;
  if (pushRegistrationState.pending) return pushRegistrationState.pending;
  pushRegistrationState.pending = (async () => {
    await attachPushListeners();
    const permission = await pushNotifications.requestPermissions();
    if (permission.receive !== "granted") throw new Error("Notification permission not granted");
    let timer, registrationListener, errorListener;
    let resolveToken, rejectToken;
    const registered = new Promise((resolve, reject) => { resolveToken = resolve; rejectToken = reject; });
    registered.catch(() => {});
    try {
      registrationListener = await pushNotifications.addListener("registration", token => resolveToken(token.value));
      errorListener = await pushNotifications.addListener("registrationError", () => rejectToken(new Error("Push registration failed")));
      timer = setTimeout(() => rejectToken(new Error("Push registration timed out")), 15000);
      await pushNotifications.register();
      const token = await registered;
      storePushToken(token);
      return token;
    } finally {
      clearTimeout(timer);
      await registrationListener?.remove();
      await errorListener?.remove();
    }
  })().finally(() => { pushRegistrationState.pending = null; });
  return pushRegistrationState.pending;
}

async function saveServerSideAlert(item, waitTime, mode) {
  const deviceToken = await initializePushNotifications();

  if (!deviceToken) {
    throw new Error("Push notifications were not granted on this device");
  }

  await window.AlertSecurity.verifyDevice(deviceToken, pushNotifications);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await window.AlertSecurity.request("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          park: alertVar.toLowerCase() === "ushollywood" ? "hollywood" : alertVar.toLowerCase(),
          rideId: item.id,
          waitTime,
          mode
        })
      });

      if (!response.ok) {
        let message = `Failed to save alert (${response.status})`;

        try {
          const payload = await response.json();
          if (payload?.message) {
            message = `${message}: ${payload.message}`;
          }
        } catch (error) {
          // Keep the HTTP status message when the response body is not JSON.
        }

        throw new Error(message);
      }

      return response.json();
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
}

function openSetAlertModal(item) {
  const modal = document.querySelector(".waitTimeAlertModal");

  modal.innerHTML = window.SafeHTML.sanitize(`
    <div class="modalInner">
      <h3>${window.SafeHTML.text(item.name)}</h3>
      <p>Current wait: ${item.waitTime} min</p>

      <label for="alertMode">Notify me when</label>
      <select id="alertMode">
        <option value="threshold">Set a wait time</option>
        <option value="good_time">Tell me when is the best time</option>
      </select>
      <div id="alertThresholdFields">
        <small class="alert-threshold-help">Alerts you when the wait reaches your chosen time or drops below it.</small>
        <label for="alertValue">Wait time (minutes)</label>
        <input type="number" id="alertValue" min="0" max="300" step="1" placeholder="Minutes" />
      </div>
      <p id="alertErrorMsg" class="alert-error" style="display:none;"></p>

      <div class="modalActions">
        <button id="closeModalBtn">Cancel</button>
        <button id="saveAlertBtn">Save</button>
      </div>
    </div>
  `);

  modal.style.display = "flex";

  document.getElementById("closeModalBtn").onclick = () => {
    modal.style.display = "none";
  };

  document.getElementById("alertMode").onchange = event => {
    const smart = event.target.value === "good_time";
    document.getElementById("alertThresholdFields").hidden = smart;
  };

  document.getElementById("saveAlertBtn").onclick = async () => {
    const saveButton = document.getElementById("saveAlertBtn");
    const errorMessage = document.getElementById("alertErrorMsg");
    const mode = document.getElementById("alertMode").value;
    const rawValue = document.getElementById("alertValue").value;
    const value = mode === "good_time" ? null : Number(rawValue);
    if (mode === "threshold" && (!rawValue.trim() || !Number.isInteger(value) || value < 0 || value > 300)) {
      errorMessage.textContent = "Enter a whole number from 0 to 300 minutes.";
      errorMessage.style.display = "block";
      return;
    }

    try {
      errorMessage.style.display = "none";
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      if (canUseServerSidePush()) {
        await saveServerSideAlert(item, value, mode);
      } else {
        const park = alertVar.toLowerCase() === "ushollywood" ? "hollywood" : alertVar.toLowerCase();
        const existing = waitTimeAlerts.find(alert => alert.name === item.name && (!alert.park || alert.park === park));
        if (existing) {
          existing.waitTime = value;
          existing.mode = mode;
          existing.lastObservedWait = window.AlertRules.observation(item);
          existing.park = park;
          existing.rideId = item.id;
          delete existing.triggeredAt;
        } else {
          waitTimeAlerts.push({
            id: crypto.randomUUID(), rideId: item.id, name: item.name, park, waitTime: value, mode, lastObservedWait: window.AlertRules.observation(item)
          });
        }

        localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
      }

      if (typeof markRideAlertSet === "function") markRideAlertSet(item);
      modal.style.display = "none";
    } catch (error) {
      console.error("Failed to save alert:", error);
      errorMessage.textContent = error?.message || "Could not save alert. Please try again.";
      errorMessage.style.display = "block";
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  };
}


/*************************
 * CHECK ALERTS
 *************************/
function checkAlerts(park) {
  if (canUseServerSidePush()) return;
  if (!waitTimeAlerts.length) return;

  // Build allItems based on the park
  let allItems = [];

  if (park === "wdw") {
    allItems = [
      ...parks.mg.rides, ...parks.mg.shows, ...parks.mg.res,
      ...parks.epcot.rides, ...parks.epcot.shows, ...parks.epcot.res,
      ...parks.ak.rides, ...parks.ak.shows, ...parks.ak.res,
      ...parks.hollywood.rides, ...parks.hollywood.shows, ...parks.hollywood.res
    ];
  } else if (park === "usOrlando") {
    allItems = [
      ...parks.usfl.rides, ...parks.usfl.shows,
      ...parks.epic.rides, ...parks.epic.shows,
      ...parks.islandofAdventure.rides, ...parks.islandofAdventure.shows,
      ...parks.volcanoBay.rides
    ];
  } else if (park === "disneyland") {
    allItems = [
      ...parks.disneyland.rides, ...parks.disneyland.shows, ...parks.disneyland.res,
      ...parks.caliadv.rides, ...parks.caliadv.shows, ...parks.caliadv.res
    ];
  } else if (park === "usHollywood") {
    allItems = [
      ...parks.usHollywood.rides, ...parks.usHollywood.shows
    ];
  }

  const triggered = [];

  waitTimeAlerts.forEach(alert => {
    const parkKey = park.toLowerCase() === "ushollywood" ? "hollywood" : park.toLowerCase();
    if (alert.park && alert.park !== parkKey) return;
    const match = allItems.find(item => alert.rideId ? item.id === alert.rideId : item.name === alert.name);
    if (!match) return;
    const evaluated = window.AlertRules.evaluate(alert, match);
    if (evaluated.isTriggered && (alert.mode === "good_time" || !alert.triggeredAt)) {
      triggered.push({ ...match, alertWait: alert.waitTime, mode: alert.mode, isDown: evaluated.isDown });
      alert.triggeredAt = new Date().toISOString();
    }
    if (alert.mode === "good_time") alert.lastObservedWait = window.AlertRules.observation(match);
  });
  localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
  if (triggered.length) openTriggeredModal(triggered);
}


/*************************
 * TRIGGERED MODAL
 *************************/
function openTriggeredModal(alerts) {
  const modal = document.querySelector(".waitTimeAlertModal");
  if (!modal) return;

  modal.innerHTML = window.SafeHTML.sanitize(`
    <div class="modalInner">
      <h2>Wait Time Alerts</h2>

      ${alerts.map(a => `
        <div class="alertBlock">
          <strong>${window.SafeHTML.text(a.name)}</strong>
          ${
            a.isDown
              ? `<p class="alert-down">Status: Currently Down</p>`
              : a.mode === "good_time"
                ? `<p>Wait dropped to ${a.waitTime} min. It is a good time to ride!</p>`
                : `<p>Now: ${a.waitTime} min (alert: ${a.alertWait} min)</p>`
          }
        </div>
      `).join("")}

      <button id="closeModalBtn">OK</button>
    </div>
  `);

  modal.style.display = "flex";

  document.getElementById("closeModalBtn").onclick = () => {
    modal.style.display = "none";
  };
}

document.addEventListener("click", e => {
  const header = e.target.closest(".addInfo-header");
  if (!header) return;

  header.parentElement.classList.toggle("open");
});
