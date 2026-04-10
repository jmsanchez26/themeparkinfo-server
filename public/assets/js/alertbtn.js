

/*************************
 * ALERT MODAL
 *************************/
const isNativeApp =
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === "function" &&
  window.Capacitor.isNativePlatform();

const pushNotifications = window.Capacitor?.Plugins?.PushNotifications;
const localNotifications = window.Capacitor?.Plugins?.LocalNotifications;
const FOREGROUND_ALERT_CHANNEL_ID = "foreground-wait-alerts";

const pushRegistrationState = {
  token: null,
  pending: null,
  listenersAttached: false
};

function canUseServerSidePush() {
  return Boolean(isNativeApp && window.__API_BASE__ && pushNotifications);
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

async function attachPushListeners() {
  if (!canUseServerSidePush() || pushRegistrationState.listenersAttached) return;

  await pushNotifications.addListener("registration", token => {
    storePushToken(token.value);
  });

  await pushNotifications.addListener("registrationError", error => {
    console.error("Push registration failed:", error);
  });

  await pushNotifications.addListener("pushNotificationReceived", async notification => {
    if (!localNotifications) return;

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
            schedule: { at: new Date(Date.now() + 250) }
          }
        ]
      });
    } catch (error) {
      console.error("Foreground notification display failed:", error);
    }
  });

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
        visibility: 1
      });
    } catch (error) {
      console.warn("Could not create local notification channel:", error);
    }
  }

  const storedToken = pushRegistrationState.token || getStoredPushToken();
  if (storedToken) {
    pushRegistrationState.token = storedToken;
    return storedToken;
  }

  await attachPushListeners();

  const permission = await pushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    throw new Error("Notification permission not granted");
  }

  await pushNotifications.register();
  return ensurePushToken();
}

async function ensurePushToken() {
  if (!canUseServerSidePush()) return null;

  const storedToken = pushRegistrationState.token || getStoredPushToken();
  if (storedToken) {
    pushRegistrationState.token = storedToken;
    return storedToken;
  }

  if (pushRegistrationState.token) return pushRegistrationState.token;
  if (pushRegistrationState.pending) return pushRegistrationState.pending;

  pushRegistrationState.pending = new Promise(async (resolve, reject) => {
    let settled = false;
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    try {
      await attachPushListeners();

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const latestToken = pushRegistrationState.token || getStoredPushToken();
        if (latestToken) {
          pushRegistrationState.token = latestToken;
          resolve(latestToken);
          return;
        }
        reject(new Error("Push registration timed out"));
      }, 10000);

      const token = await initializePushNotifications();
      settled = true;
      cleanup();
      resolve(token);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  }).finally(() => {
    pushRegistrationState.pending = null;
  });

  return pushRegistrationState.pending;
}

async function saveServerSideAlert(item, waitTime) {
  const deviceToken = await ensurePushToken();

  if (!deviceToken) {
    throw new Error("Push notifications were not granted on this device");
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${window.__API_BASE__}/api/alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          park: alertVar,
          name: item.name,
          waitTime,
          deviceToken
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

  modal.innerHTML = `
    <div class="modalInner">
      <h3>${item.name}</h3>
      <p>Current wait: ${item.waitTime} min</p>

      <label>Alert me when wait time is</label>
      <input type="number" id="alertValue" placeholder="Minutes" />
      <p id="alertErrorMsg" class="alert-error" style="display:none;"></p>

      <div class="modalActions">
        <button id="closeModalBtn">Cancel</button>
        <button id="saveAlertBtn">Save</button>
      </div>
    </div>
  `;

  modal.style.display = "flex";

  document.getElementById("closeModalBtn").onclick = () => {
    modal.style.display = "none";
  };

  document.getElementById("saveAlertBtn").onclick = async () => {
    const saveButton = document.getElementById("saveAlertBtn");
    const errorMessage = document.getElementById("alertErrorMsg");
    const value = parseInt(document.getElementById("alertValue").value, 10);
    if (!value) {
      errorMessage.textContent = "Enter a wait time in minutes.";
      errorMessage.style.display = "block";
      return;
    }

    try {
      errorMessage.style.display = "none";
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      if (canUseServerSidePush()) {
        await saveServerSideAlert(item, value);
      } else {
        waitTimeAlerts.push({
          name: item.name,
          waitTime: value
        });

        localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
      }

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
  if (isNativeApp && pushNotifications) return;
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
    const match = allItems.find(i => i.name === alert.name);
    if (!match) return;

    const statusLower = match.status?.toLowerCase();
    const hasWait = typeof match.waitTime === "number";

    if (
      (statusLower === "operating" && hasWait && match.waitTime <= alert.waitTime) ||
      statusLower !== "operating"
    ) {
      triggered.push({
        ...match,
        alertWait: alert.waitTime,
        isDown: statusLower !== "operating"
      });
    }
  });

  if (triggered.length) {
    waitTimeAlerts = waitTimeAlerts.filter(
      alert => !triggered.some(trigger => trigger.name === alert.name)
    );
    localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
    openTriggeredModal(triggered);
  }
}


/*************************
 * TRIGGERED MODAL
 *************************/
function openTriggeredModal(alerts) {
  const modal = document.querySelector(".waitTimeAlertModal");
  if (!modal) return;

  modal.innerHTML = `
    <div class="modalInner">
      <h2>Wait Time Alerts</h2>

      ${alerts.map(a => `
        <div class="alertBlock">
          <strong>${a.name}</strong>
          ${
            a.isDown
              ? `<p class="alert-down">Status: Currently Down</p>`
              : `<p>Now: ${a.waitTime} min (alert: ${a.alertWait} min)</p>`
          }
        </div>
      `).join("")}

      <button id="closeModalBtn">OK</button>
    </div>
  `;

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

document.addEventListener("DOMContentLoaded", () => {
  if (!canUseServerSidePush()) return;

  initializePushNotifications().catch(error => {
    console.error("Push init failed:", error);
  });
});
