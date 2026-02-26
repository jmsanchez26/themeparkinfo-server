
let waitTimeAlerts = JSON.parse(localStorage.getItem("waitTimeAlerts"));
if (!Array.isArray(waitTimeAlerts)) waitTimeAlerts = [];

/*************************
 * LOG SAVED ALERTS
 *************************/
function logSavedAlerts(context) {
  console.log(`Saved Alerts (${context}):`, waitTimeAlerts);
}

/*************************
 * FETCH DATA
 *************************/
function getParkData() {

fetch(apiUrl)
  .then(res => {
    if (!res.ok) {
      throw new Error("Server returned " + res.status);
    }
    return res.json();
  })
  .then(response => {

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
          
          // Filter for showtimes that start after right now
          upcomingShowTimes = hasShowTimes.filter(show => {
            return new Date(show.startTime) > now;
          });

          if (upcomingShowTimes.length > 0) {
            nextShowTime = formatLLTime(upcomingShowTimes[0].endTime);
          }else{
            status = 'Closed';
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
          nextShowTime: nextShowTime
        };

        if (type === "attraction") parks[parkKey].rides.push(entry);
        else if (type === "show") parks[parkKey].shows.push(entry);
        else parks[parkKey].res.push(entry);

      });

      renderAll();
      checkAlerts(alertVar);

    })
    .catch(err => console.error("API Error:", err));
}

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
  //console.log(parks[park][type]);

  parks[park][type].forEach(item => {
    const statusLower = item.status?.toLowerCase();
    const hasWait = typeof item.waitTime === "number";
    const rideNow = item.rideNow;
    const card = document.createElement("div");
    const nextLLTime = item.NextLL; 
    const rideAverageWaitTime = item.avgWaitTime;
    const waitWillDrop = item.waitDopBool;
    const paidLLPriceVal = item.paidLL;
    const nextShowTime = item.nextShowTime;
    let waitForecastIcon = '';
    card.className = "wait-card";
    if (statusLower === "operating" && hasWait && rideNow !== null) {
      waitForecastIcon = rideNow === true
      ? '<i class="fa fa-thumbs-up"></i>'
      : '<i class="fa fa-hand-paper-o"></i>';
    }

    card.innerHTML = `
      <div class="card-title">
        <h3>${waitForecastIcon} ${item.name}</h3>
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
      ${
        statusLower === "operating" &&
        hasWait &&
        waitWillDrop === true &&
        rideAverageWaitTime !== null
          ? `
            <div class="wait-card-addInfo">
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
 * INIT
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  if (typeof initParkTabs === "function") initParkTabs();
  if (typeof initSubTabs === "function") initSubTabs();

  getParkHours(intialparkHrs);
  logSavedAlerts("page load");

  getParkData();
  setInterval(getParkData, 30000);
});