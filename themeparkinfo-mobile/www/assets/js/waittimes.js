
let waitTimeAlerts = JSON.parse(localStorage.getItem("waitTimeAlerts"));
if (!Array.isArray(waitTimeAlerts)) waitTimeAlerts = [];
let favoriteRideKeys = JSON.parse(localStorage.getItem("favoriteRideKeys"));
if (!Array.isArray(favoriteRideKeys)) favoriteRideKeys = [];
let parkDataRequestInFlight = false;
let parkDataRetryTimeoutId = null;
let lastResumeRefreshAt = 0;
const appLifecyclePlugin = window.Capacitor?.Plugins?.App;

/*************************
 * LOG SAVED ALERTS
 *************************/
function logSavedAlerts(context) {
  console.log(`Saved Alerts (${context}):`, waitTimeAlerts);
}

function buildFavoriteRideKey(park, item) {
  return `${park}::${item.id || item.name}`;
}

function isFavoriteRide(park, item) {
  return favoriteRideKeys.includes(buildFavoriteRideKey(park, item));
}

function persistFavoriteRides() {
  localStorage.setItem("favoriteRideKeys", JSON.stringify(favoriteRideKeys));
}

function toggleFavoriteRide(park, item) {
  const rideKey = buildFavoriteRideKey(park, item);

  if (favoriteRideKeys.includes(rideKey)) {
    favoriteRideKeys = favoriteRideKeys.filter(key => key !== rideKey);
  } else {
    favoriteRideKeys.push(rideKey);
  }

  persistFavoriteRides();
}

/*************************
 * FETCH DATA
 *************************/
function queueParkDataRetry(delayMs = 3000) {
  if (parkDataRetryTimeoutId) return;

  parkDataRetryTimeoutId = setTimeout(() => {
    parkDataRetryTimeoutId = null;
    getParkData();
  }, delayMs);
}

function refreshParkDataOnResume() {
  const now = Date.now();
  if (now - lastResumeRefreshAt < 1500) return;

  lastResumeRefreshAt = now;

  if (typeof renderAll === "function") {
    renderAll();
  }

  getParkData();
}

async function getParkData() {
  if (parkDataRequestInFlight) return;
  parkDataRequestInFlight = true;

  try {
    const res = await fetch(apiUrl, {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error("Server returned " + res.status);
    }

    const response = await res.json();

    if (response.error) {
      console.warn("API Error:", response.message);
    }

    if (response.warning) {
      console.warn("⚠", response.message);
    }

    if (!response.data || !response.data.liveData) {
      console.warn("No live data available");
      return;
    }

    const data = response.data;

    resetData();

      data.liveData?.forEach(item => {
        let waitTime = item.queue?.STANDBY?.waitTime;
        //waitTime = 1;
        const attrName = item.name;
        const type = item.entityType.toLowerCase();
        const parkKey = getParkKey(item.parkId);
        const rideID  = item.id;
        const forecastData = item.forecast;
        const llAvailable = item.queue?.RETURN_TIME?.state;
        const paidLLAvailable = item.queue?.PAID_RETURN_TIME?.state
        const hasShowTimes = item.showtimes || []; 
        let status = item.status;
        let upcomingShowTimes = [];
        let goodTimeToRide = null;
        let waitTimeWillDrop = null;
        let NextLLregularTime = null;
        let attrAvgWaitTime = null; 
        let paidLLPrice = null;
        let nextShowTime = null;

        const formatLLTime = (isoTime) => {
          if (!isoTime) return null;

          let [hours, minutes] = isoTime.split("T")[1].split(":");
          hours = Number(hours);

          const suffix = hours >= 12 ? "PM" : "AM";
          hours = (hours % 12) || 12;

          return `${hours}:${minutes} ${suffix}`;
        };

        if (llAvailable === "AVAILABLE") {
          NextLLregularTime = formatLLTime(item.queue?.RETURN_TIME?.returnStart);
        }

        if (paidLLAvailable === "AVAILABLE") {
          NextLLregularTime = formatLLTime(item.queue?.PAID_RETURN_TIME?.returnStart);
          paidLLPrice = item.queue?.PAID_RETURN_TIME?.price?.formatted;
        }

        if (type === "show" && hasShowTimes.length > 0) {
          const now = new Date();

          const normalizedShowTimes = hasShowTimes
            .map(show => ({
              start: show.startTime ? new Date(show.startTime) : null,
              end: show.endTime ? new Date(show.endTime) : null
            }))
            .filter(show => show.start && !Number.isNaN(show.start.getTime()))
            .sort((a, b) => a.start - b.start);

          const activeShow = normalizedShowTimes.find(show => {
            const endTime = show.end && !Number.isNaN(show.end.getTime()) ? show.end : null;
            return endTime ? show.start <= now && now < endTime : show.start <= now;
          });

          upcomingShowTimes = normalizedShowTimes.filter(show => show.start > now);

          if (activeShow) {
            nextShowTime = activeShow.end
              ? `Open now until ${formatLLTime(activeShow.end.toISOString())}`
              : "Open now";
          } else if (upcomingShowTimes.length > 0) {
            nextShowTime = `Next: ${formatLLTime(upcomingShowTimes[0].start.toISOString())}`;
          }
        }

        if (forecastData) {
          const forecastResult = fetchWaitTimeForecast(
            item.name,
            waitTime,
            forecastData,
          );

          if (Array.isArray(forecastResult)) {
            [goodTimeToRide, waitTimeWillDrop, lowestWaitNextTwoHrs, attrAvgWaitTime] = forecastResult;
          }
        }
        
        if (!parkKey) return;
        const collectionKey = getCollectionKeyForType(type);
        const defaultOrder = parks[parkKey][collectionKey].length;

        const entry = {
          name: attrName,
          waitTime,
          status,
          id: rideID,
          rideNow: goodTimeToRide,
          NextLL: NextLLregularTime,
          avgWaitTime: attrAvgWaitTime,
          waitDopBool: waitTimeWillDrop,
          paidLL: paidLLPrice,
          nextShowTime: nextShowTime,
          defaultOrder
        };

        parks[parkKey][collectionKey].push(entry);

      });

      renderAll();
      checkAlerts(alertVar);
  } catch (err) {
    console.error("API Error:", err);
    queueParkDataRetry();
  } finally {
    parkDataRequestInFlight = false;
  }
}

function resetData() {
  Object.keys(parks).forEach(p => {
    parks[p].rides = [];
    parks[p].shows = [];
    parks[p].res = [];
  });
}

function getCollectionKeyForType(type) {
  if (type === "attraction") return "rides";
  if (type === "show") return "shows";
  return "res";
}

function getParkKey(parkId) {
  return Object.keys(PARK_IDS).find(k => PARK_IDS[k] === parkId);
}

function fetchWaitTimeForecast(name, currentWaitTime, forecastArr = []) {
  let runningWaitTimeCounter = 0;
  let arrCount = 0; 
  let waitWillDrop = false; 
  let lowestWait = currentWaitTime;
  let lowestWaitTimeStamp = '';
  let goodToRide;

  const now = new Date();

  // Remove forecast entries that already happened
  const futureForecast = forecastArr.filter(item => {
    return new Date(item.time) >= now;
  });

  // Safety check
if (!futureForecast.length) {
  return [null, false, currentWaitTime];
}
  //console.log('----------------------');
//   console.log(name)
// console.log(futureForecast);

  futureForecast.forEach(item => {
    arrCount++;
    runningWaitTimeCounter += item.waitTime;

    if (item.waitTime < lowestWait && arrCount <= 2) {
      waitWillDrop = true;
      lowestWait = item.waitTime;
      lowestWaitTimeStamp = item.time;
    }

  });

  const avgWaitTime = Math.round(runningWaitTimeCounter / arrCount);
  const isClose = Math.abs(currentWaitTime - avgWaitTime) <= 4;

  if(isClose){
    goodToRide = true;
  }else if (currentWaitTime < avgWaitTime) {
    goodToRide = true;
  }else if(!waitWillDrop){
    goodToRide = true;
  }else if(currentWaitTime < 20){
    goodToRide = true;
  }else {
    goodToRide = false;
  }

  // console.log({
  //   attraction: name,
  //   currentWaitTime,
  //   isClose,
  //   avgWaitTime,
  //   lowestUpcomingWait: lowestWait,
  //   waitWillDrop,
  //   goodToRide,
  //   lowestWaitTimeStamp
  // });
  return [goodToRide, waitWillDrop, lowestWait, avgWaitTime];
}

function renderCards(park, type, selector) {
  const container = document.querySelector(selector);
  if (!container) return;
  container.innerHTML = "";
  const items = [...parks[park][type]];
  const wrapper = container.closest(".card-wrapper");
  if (type === "rides") {
    items.sort((a, b) => {
      const aFavorite = isFavoriteRide(park, a) ? 1 : 0;
      const bFavorite = isFavoriteRide(park, b) ? 1 : 0;
      return bFavorite - aFavorite;
    });
  }

  items.forEach(item => {
    const statusLower = item.status?.toLowerCase();
    const hasWait = typeof item.waitTime === "number";
    const rideNow = item.rideNow;
    const card = document.createElement("div");
    const nextLLTime = item.NextLL; 
    const rideAverageWaitTime = item.avgWaitTime;
    const waitWillDrop = item.waitDopBool;
    const paidLLPriceVal = item.paidLL;
    const nextShowTime = item.nextShowTime;
    const isFavorite = type === "rides" && isFavoriteRide(park, item);
    let waitForecastIcon = '';
    card.className = type === "rides" ? "wait-card wait-card-modern" : "wait-card";
    if (statusLower === "operating" && hasWait && rideNow !== null) {
      waitForecastIcon = rideNow === true
      ? '<i class="fa fa-thumbs-up"></i>'
      : '<i class="fa fa-hand-paper-o"></i>';
    }

    card.innerHTML = type === "rides"
      ? `
        <div class="saved-alert-head wait-card-head">
          <div class="saved-alert-title-row wait-card-title-row">
            <h3>${waitForecastIcon} ${item.name}</h3>
            <button class="favoriteRideBtn ${isFavorite ? "active" : ""}" type="button" aria-label="${isFavorite ? "Remove from favorites" : "Add to favorites"}">
              <i class="fa fa-star"></i>
            </button>
          </div>
          <span class="saved-alert-chip ${statusLower === "operating" ? "watching" : "hit"}">
            ${item.status || "Unknown"}
          </span>
        </div>

        <div class="saved-alert-stats wait-card-stats">
          <div class="saved-alert-stat">
            <span class="saved-alert-stat-label">Current wait</span>
            <span class="saved-alert-stat-value">
              ${statusLower === "operating" && hasWait ? `${item.waitTime} min` : "No posted wait"}
            </span>
          </div>
          ${
            nextLLTime
              ? `<div class="saved-alert-stat">
                  <span class="saved-alert-stat-label">LL</span>
                  <span class="saved-alert-stat-value">${nextLLTime}</span>
                  ${paidLLPriceVal ? `<span class="saved-alert-stat-subvalue">${paidLLPriceVal}</span>` : ""}
                </div>`
              : ``
          }
        </div>

        ${
          statusLower === "operating" &&
          hasWait &&
          waitWillDrop === true &&
          rideAverageWaitTime !== null
            ? `
              <div class="wait-card-addInfo wait-card-addInfo-modern">
                <div class="addInfo-header">
                  <span>Wait Insights</span>
                  <i class="fa fa-chevron-down"></i>
                </div>

                <div class="addInfo-content">
                  <div class="avgWait">
                    Average wait today: ${rideAverageWaitTime} min
                  </div>

                  <div class="dropNotice">
                    Expected to drop even more within the next 2 hours
                  </div>
                </div>
              </div>
            `
            : ""
        }

        <div class="wait-card-footer">
          ${
            statusLower === "operating" && hasWait
              ? `<button class="waitTimeRemBtn"><i class="fa fa-bell"></i> Set Alert</button>`
              : ""
          }
        </div>
      `
      : `
        <div class="card-title">
          <h3>${waitForecastIcon} ${item.name}</h3>
          ${type === "rides" ? `
            <button class="favoriteRideBtn ${isFavorite ? "active" : ""}" type="button" aria-label="${isFavorite ? "Remove from favorites" : "Add to favorites"}">
              <i class="fa fa-star"></i>
            </button>
          ` : ""}
        </div>
        <div class="wait-card-inner">
          <div class="card-left">
            <span class="status ${statusLower === "operating" ? "active" : "inactive"}">
              ${item.status}
            </span>
          </div>
          <div class="card-middle">
              <div class="wait-time">
                <div class="currentWait">
                  ${statusLower === "operating" && hasWait 
                    ? `<i class="fa fa-clock-o"></i> ${item.waitTime} min` 
                    : (item.nextShowTime && statusLower === "operating"? `<i class="fa fa-calendar-check-o"></i> ${item.nextShowTime}` : "")
                  }
                </div>              
                ${statusLower === "operating" && hasWait && nextLLTime
                  ? `<div class="nextLL">
                      <i class="fa fa-bolt" aria-hidden="true"></i>
                      ${nextLLTime}
                      ${paidLLPriceVal ? `<br> ${paidLLPriceVal}` : ""}
                    </div>`
                  : ""}              
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

    if (type === "rides") {
      card.querySelector(".favoriteRideBtn")?.addEventListener("click", () => {
        toggleFavoriteRide(park, item);
        renderAll();
      });
    }

    container.appendChild(card);
  });
}

/*************************
 * INIT
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  if (typeof initParkTabs === "function") initParkTabs();
  if (typeof initSubTabs === "function") initSubTabs();

  const requestedPark = new URLSearchParams(window.location.search).get("park");
  if (!requestedPark) {
    getParkHours(intialparkHrs);
  }
  logSavedAlerts("page load");

  getParkData();
  setInterval(getParkData, 30000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshParkDataOnResume();
    }
  });

  window.addEventListener("pageshow", () => {
    refreshParkDataOnResume();
  });

  if (appLifecyclePlugin?.addListener) {
    appLifecyclePlugin.addListener("appStateChange", state => {
      if (state?.isActive) {
        refreshParkDataOnResume();
      }
    });
  }
});
