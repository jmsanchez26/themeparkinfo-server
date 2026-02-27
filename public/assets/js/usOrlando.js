/*************************
 * UNIVERSAL ORLANDO DATA
 *************************/
const timeZone = 'America/New_York';

  const idToKey = {
    "usfl": "usfl",
    "epic": "epic",
    "volcanoBay": "volcanoBay",
    "islandofAdventure": "islandofAdventure"
  };

const parks = {
  usfl: { rides: [], shows: [], res: [] },
  islandofAdventure: { rides: [], shows: [], res: [] },
  epic: { rides: [], shows: [], res: [] },
  volcanoBay: { rides: [], shows: [], res: [] }
};

const PARK_IDS = {
  usfl: "eb3f4560-2383-4a36-9152-6b3e5ed6bc57",
  islandofAdventure: "267615cc-8943-4c2a-ae2c-5da728ca591f",
  epic: "12dbb85b-265f-44e6-bccf-f1faa17211fc",
  volcanoBay: "fe78a026-b91b-470c-b906-9d2266b692da"
};
let waitTimeAlerts = JSON.parse(localStorage.getItem("waitTimeAlerts"));
if (!Array.isArray(waitTimeAlerts)) waitTimeAlerts = [];

/*************************
 * FETCH LIVE DATA
 *************************/
async function getUSOLiveData() {
  try {
    const res = await fetch(
      "https://api.themeparks.wiki/v1/entity/89db5d43-c434-4097-b71f-f6869f495a22/live"
    );
    const data = await res.json();

    resetData();

    data.liveData.forEach(item => {
      const parkKey = getParkKey(item.parkId);
      if (!parkKey) return;

      const type = normalizeType(item.entityType);
      if (!type) return;

      let waitTime = item.queue?.STANDBY?.waitTime;
      const status = item.status;
      const showtimes = item.showtimes || [];
      const lastTimeUpdated = item.lastUpdated;
      const now = new Date();
      const threeWeeksAgo = new Date(now);
      threeWeeksAgo.setDate(now.getDate() - 21);
      const threeWeeksAgoStr = threeWeeksAgo.toISOString();
      let nextShowTime = null;


    if(lastTimeUpdated < threeWeeksAgoStr && status.toLowerCase() === 'closed' ) return;

      if (type === "shows" && showtimes.length) {
        const upcoming = showtimes.find(s => new Date(s.startTime) > now);
        if (upcoming) nextShowTime = formatTime(upcoming.startTime);
      }

      parks[parkKey][type].push({
        id: item.id,
        name: item.name,
        status,
        waitTime,
        nextShowTime
      });
    });

    renderAllParks();
      checkAlerts('usOrlando');

  } catch (err) {
    console.error("Universal API Error:", err);
  }
}

/*************************
 * HELPERS
 *************************/
function resetData() {
  Object.keys(parks).forEach(p => {
    parks[p].rides = [];
    parks[p].shows = [];
    parks[p].res = [];
  });
}

function getParkKey(parkId) {
  return Object.keys(PARK_IDS).find(k => PARK_IDS[k] === parkId);
}

function normalizeType(type) {
  if (!type) return null;
  type = type.toLowerCase();
  if (type === "attraction") return "rides";
  if (type === "show") return "shows";
  return "res";
}

function formatTime(iso) {
  const date = new Date(iso);
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/*************************
 * RENDERING
 *************************/
function renderAllParks() {
  renderCards("usfl", "rides", ".usfl-attractions .card-list");
  renderCards("usfl", "shows", ".usfl-shows .card-list");
  renderCards("usfl", "res", ".usfl-res .card-list");

  renderCards("islandofAdventure", "rides", ".islandofAdventure-attractions .card-list");
  renderCards("islandofAdventure", "shows", ".islandofAdventure-shows .card-list");

  renderCards("epic", "rides", ".epic-attractions .card-list");
  renderCards("epic", "shows", ".epic-shows .card-list");

  renderCards("volcanoBay", "rides", ".volcanoBay-attractions .card-list");
  renderCards("volcanoBay", "shows", ".volcanoBay-shows .card-list");
}

function renderCards(park, type, selector) {
  const container = document.querySelector(selector);
  if (!container) return;

  container.innerHTML = "";

  parks[park][type].forEach(item => {
    const statusLower = item.status?.toLowerCase();
    const hasWait = typeof item.waitTime === "number";

    const card = document.createElement("div");
    card.className = "wait-card";

    card.innerHTML = `
      <div class="card-title">
        <h3>${item.name}</h3>
      </div>

      <div class="wait-card-inner">
        <div class="card-left">
          <span class="status ${statusLower === "operating" ? "active" : "inactive"}">
            ${item.status}
          </span>
        </div>

        <div class="card-middle">
          <div class="wait-time">
            ${
              statusLower === "operating" && hasWait
                ? `<i class="fa fa-clock-o"></i> ${item.waitTime} min`
                : item.nextShowTime
                ? `<i class="fa fa-calendar-check-o"></i> ${item.nextShowTime}`
                : ""
            }
          </div>
        </div>
        <div class="card-right">
          ${
            statusLower === "operating" && hasWait
              ? `<button class="waitTimeRemBtn"><i class="fa fa-bell"></i> Set Alert</button>`
              : ""
          }
        </div>
      </div>
    `;
    if (statusLower === "operating" && hasWait) {
      card.querySelector(".waitTimeRemBtn").addEventListener("click", () => {
        openSetAlertModal(item);
      });
    }

    container.appendChild(card);
  });
}
/*************************
 * LOG SAVED ALERTS
 *************************/
function logSavedAlerts(context) {
  console.log(`Saved Alerts (${context}):`, waitTimeAlerts);
}
/*************************
 * INIT
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  if (typeof initParkTabs === "function") initParkTabs();
  if (typeof initSubTabs === "function") initSubTabs();
    
  getParkHours('usfl');
  logSavedAlerts("page load");

  getUSOLiveData();
  setInterval(getUSOLiveData, 30000);
});