
let waitTimeAlerts = JSON.parse(localStorage.getItem("waitTimeAlerts"));
if (!Array.isArray(waitTimeAlerts)) waitTimeAlerts = [];
let favoriteRideKeys = JSON.parse(localStorage.getItem("favoriteRideKeys"));
if (!Array.isArray(favoriteRideKeys)) favoriteRideKeys = [];
let parkDataRequestInFlight = false;
let parkDataRetryTimeoutId = null;
let lastResumeRefreshAt = 0;
const appLifecyclePlugin = window.Capacitor?.Plugins?.App;
const RIDE_PARK_LABELS = {
  mg: "Magic Kingdom",
  epcot: "EPCOT",
  ak: "Animal Kingdom",
  hollywood: "Hollywood Studios",
  disneyland: "Disneyland Park",
  caliadv: "California Adventure",
  usfl: "Universal Studios Florida",
  islandofAdventure: "Islands of Adventure",
  epic: "Epic Universe",
  volcanoBay: "Volcano Bay",
  usHollywood: "Universal Studios Hollywood"
};
const RIDE_HEIGHTS = window.__RIDE_METADATA__?.heights || {};
const DISNEY_RIDE_PARKS = new Set(["mg", "epcot", "ak", "hollywood", "disneyland", "caliadv"]);
const NORMALIZED_RIDE_HEIGHTS = Object.entries(RIDE_HEIGHTS).map(([key, value]) => ({
  key,
  normalizedKey: normalizeRideMetaKey(key),
  value
}));

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

function normalizeRideMetaKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[™®]/g, "")
    .replace(/\b(?:tm|sm|r)\b/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9:&+\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRideHeight(park, item) {
  const idKey = item.id ? `${park}::${item.id}` : null;
  const nameKey = `${park}::${item.name}`;
  const normalizedIdKey = idKey ? normalizeRideMetaKey(idKey) : null;
  const normalizedNameKey = normalizeRideMetaKey(nameKey);
  const exactMatch =
    (idKey && RIDE_HEIGHTS[idKey]) ||
    RIDE_HEIGHTS[nameKey] ||
    (normalizedIdKey && NORMALIZED_RIDE_HEIGHTS.find(entry => entry.normalizedKey === normalizedIdKey)?.value) ||
    NORMALIZED_RIDE_HEIGHTS.find(entry => entry.normalizedKey === normalizedNameKey)?.value;

  if (exactMatch) {
    return exactMatch;
  }

  const parkPrefix = normalizeRideMetaKey(`${park}::`);
  const containsMatch = NORMALIZED_RIDE_HEIGHTS.find(entry => {
    if (!entry.normalizedKey.startsWith(parkPrefix)) return false;

    const entryRideName = entry.normalizedKey.slice(parkPrefix.length).trim();
    const rideName = normalizedNameKey.slice(parkPrefix.length).trim();

    return entryRideName.includes(rideName) || rideName.includes(entryRideName);
  });

  return containsMatch?.value || item.heightRequirement || item.height || "Not posted yet";
}

function formatRideInsight(item) {
  if (item.rideNow === true) {
    return "This looks like a good time to ride right now.";
  }

  if (item.waitDopBool === true) {
    return "Wait times are expected to drop more within the next 2 hours.";
  }

  if (item.avgWaitTime !== null && typeof item.avgWaitTime === "number") {
    return `Average wait today is around ${item.avgWaitTime} min.`;
  }

  return "No extra wait insight is available yet.";
}

function buildRideMapUrl(park, item) {
  const parkLabel = RIDE_PARK_LABELS[park] || "Theme Park";
  const query = encodeURIComponent(`${item.name}, ${parkLabel}`);
  return `https://www.google.com/maps?q=${query}&output=embed`;
}

function getRideBookingUrl(park, item) {
  if (!item?.NextLL) return null;

  const bookingUrls = {
    mg: "https://disneyworld.disney.go.com/lightning-lane-passes/",
    epcot: "https://disneyworld.disney.go.com/lightning-lane-passes/",
    ak: "https://disneyworld.disney.go.com/lightning-lane-passes/",
    hollywood: "https://disneyworld.disney.go.com/lightning-lane-passes/",
    disneyland: "https://disneyland.disney.go.com/lightning-lane-passes/",
    caliadv: "https://disneyland.disney.go.com/lightning-lane-passes/"
  };

  return bookingUrls[park] || null;
}

function openRideBookingUrl(url) {
  if (!url) return;
  window.location.href = url;
}

function getRideLLDetails(item) {
  return {
    label: item.llLabel || (item.paidLL ? "LL" : item.NextLL ? "MLL" : null),
    time: item.NextLL || null,
    price: item.paidLL || null
  };
}

function openRideDetailsModal(park, item) {
  const modal = document.querySelector(".rideDetailsModal");
  if (!modal) return;

  const hasWait = typeof item.waitTime === "number";
  const parkLabel = RIDE_PARK_LABELS[park] || "Theme Park";
  const heightText = formatRideHeight(park, item);
  const insightText = formatRideInsight(item);
  const mapUrl = buildRideMapUrl(park, item);
  const showLL = DISNEY_RIDE_PARKS.has(park);
  const showInsight = item.rideNow !== null || item.waitDopBool === true || (item.avgWaitTime !== null && typeof item.avgWaitTime === "number");
  const llDetails = getRideLLDetails(item);

  modal.innerHTML = `
    <div class="rideDetailsModalInner" role="dialog" aria-modal="true" aria-label="${item.name} details">
      <button class="rideDetailsCloseBtn" type="button" aria-label="Close ride details">
        <i class="fa fa-times"></i>
      </button>

      <div class="rideDetailsHero">
        <span class="rideDetailsPark">${parkLabel}</span>
        <h2>${item.name}</h2>
        <span class="saved-alert-chip ${String(item.status || "").toLowerCase() === "operating" ? "watching" : "hit"}">
          ${item.status || "Unknown"}
        </span>
      </div>

      <div class="rideDetailsGrid">
        <div class="rideDetailsStat">
          <span class="rideDetailsLabel">Current wait</span>
          <strong>${hasWait ? `${item.waitTime} min` : "No posted wait"}</strong>
        </div>
        <div class="rideDetailsStat">
          <span class="rideDetailsLabel">Ride height</span>
          <strong>${heightText}</strong>
        </div>
        ${showLL ? `
          <div class="rideDetailsStat">
            <span class="rideDetailsLabel">${llDetails.label || "LL"}</span>
            <strong>${item.NextLL || "Not available right now"}</strong>
            ${item.paidLL ? `<span class="rideDetailsSubvalue">${item.paidLL}</span>` : ""}
          </div>
        ` : ""}
        ${showInsight ? `
          <div class="rideDetailsStat">
            <span class="rideDetailsLabel">Wait insight</span>
            <strong>${insightText}</strong>
          </div>
        ` : ""}
      </div>

      <div class="rideDetailsSection">
        <h3>Where to find it</h3>
        <div class="rideDetailsMapWrap">
          <iframe
            src="${mapUrl}"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            allowfullscreen
            title="${item.name} map">
          </iframe>
        </div>
      </div>
    </div>
  `;

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  modal.querySelector(".rideDetailsCloseBtn")?.addEventListener("click", () => {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  });

  modal.onclick = event => {
    if (event.target === modal) {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }
  };
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
        const paidReturnStart = item.queue?.PAID_RETURN_TIME?.returnStart;
        const regularReturnStart = item.queue?.RETURN_TIME?.returnStart;
        const hasShowTimes = item.showtimes || []; 
        let status = item.status;
        let upcomingShowTimes = [];
        let goodTimeToRide = null;
        let waitTimeWillDrop = null;
        let NextLLregularTime = null;
        let attrAvgWaitTime = null; 
        let paidLLPrice = null;
        let llLabel = null;
        let nextShowTime = null;

        const formatLLTime = (isoTime) => {
          if (!isoTime) return null;

          let [hours, minutes] = isoTime.split("T")[1].split(":");
          hours = Number(hours);

          const suffix = hours >= 12 ? "PM" : "AM";
          hours = (hours % 12) || 12;

          return `${hours}:${minutes} ${suffix}`;
        };

        if (regularReturnStart && (llAvailable === "AVAILABLE" || paidLLAvailable !== "AVAILABLE")) {
          NextLLregularTime = formatLLTime(regularReturnStart);
          llLabel = "MLL";
        }

        if (paidReturnStart) {
          NextLLregularTime = formatLLTime(paidReturnStart);
          paidLLPrice = item.queue?.PAID_RETURN_TIME?.price?.formatted;
          llLabel = "LL";
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
          llLabel,
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
    const llDetails = getRideLLDetails(item);
    const bookingUrl = getRideBookingUrl(park, item);
    const showDisneyLL = DISNEY_RIDE_PARKS.has(park) && nextLLTime;
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
            showDisneyLL
              ? `<button class="saved-alert-stat llBookingBtn" type="button" aria-label="Open ${llDetails.label || "LL"} booking">
                  <span class="saved-alert-stat-label">${llDetails.label || "LL"}</span>
                  <span class="saved-alert-stat-value">${llDetails.time || nextLLTime}</span>
                  ${llDetails.price ? `<span class="saved-alert-stat-subvalue">${llDetails.price}</span>` : ""}
                </button>`
              : ``
          }
        </div>

        ${
          statusLower === "operating" &&
          hasWait &&
          rideNow === false &&
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
                      ${llDetails.label || "LL"} ${llDetails.time || nextLLTime}
                      ${llDetails.price ? `<br> ${llDetails.price}` : ""}
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
      card.querySelector(".waitTimeRemBtn").addEventListener("click", (event) => {
        event.stopPropagation();
        openSetAlertModal(item);
      });
    }

    if (type === "rides") {
      card.addEventListener("click", (event) => {
        if (
          event.target.closest(".waitTimeRemBtn") ||
          event.target.closest(".llBookingBtn") ||
          event.target.closest(".favoriteRideBtn") ||
          event.target.closest(".addInfo-header") ||
          event.target.closest(".addInfo-content")
        ) {
          return;
        }

        openRideDetailsModal(park, item);
      });

      card.querySelector(".favoriteRideBtn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavoriteRide(park, item);
        renderAll();
      });

      card.querySelector(".llBookingBtn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        openRideBookingUrl(bookingUrl);
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
