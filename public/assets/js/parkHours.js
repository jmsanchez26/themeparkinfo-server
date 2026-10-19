/*************************
 * PARK HOURS CACHE
 *************************/

const parkHoursCache =
  JSON.parse(localStorage.getItem("parkHoursCache")) || {};
let parkHoursRequest = 0;

function formatParkEventTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: timeZone, timeZoneName: 'short'
  }).format(date);
}

function setParkEventHours(events) {
  const details = document.querySelector('.park-hours-container .hours-details');
  if (!details) return;
  let container = details.querySelector('.park-event-hours');
  if (!container) {
    container = document.createElement('div');
    container.className = 'park-event-hours';
    details.appendChild(container);
  }
  container.replaceChildren();
  (Array.isArray(events) ? events : []).forEach(event => {
    const line = document.createElement('span');
    line.className = 'park-event-hours-line';
    const title = document.createElement('span');
    title.className = 'park-event-title';
    title.textContent = event.description;
    const hours = document.createElement('span');
    hours.className = 'park-event-time';
    hours.textContent = event.open + ' – ' + event.close;
    line.append(title, hours);
    container.appendChild(line);
  });
}

const PARK_HOURS_TITLES = {
  mg: "Magic Kingdom Hours",
  epcot: "EPCOT Hours",
  hollywood: "Hollywood Studios Hours",
  ak: "Animal Kingdom Hours",
  disneyland: "Disneyland Hours",
  caliadv: "California Adventure Hours",
  usfl: "Universal Studios Florida Hours",
  usHollywood: "Universal Studios Hollywood Hours",
  islandofAdventure: "Islands of Adventure Hours",
  epic: "Epic Universe Hours",
  volcanoBay: "Volcano Bay Hours"
};

function updateParkHoursTheme(parkKey) {
  const container = document.querySelector(".park-hours-container");
  if (!container) return;

  container.setAttribute("data-park-theme", parkKey);

  const titleEl = container.querySelector(".hours-title");
  if (titleEl) {
    titleEl.textContent = PARK_HOURS_TITLES[parkKey] || "Park Hours";
  }
}

/*************************
 * GET PARK HOURS (CACHED)
 *************************/
async function getParkHours(givenparkName) {
  const request = ++parkHoursRequest;
  
  // Normalize incoming names
  if (givenparkName === "magic-kingdom") givenparkName = "mg";
  else if (givenparkName === "animalKingdom") givenparkName = "ak";

  updateParkHoursTheme(givenparkName);
  setParkEventHours([]);

  const parkId = PARK_IDS[givenparkName];

  if (!parkId) {
    console.error("Unknown park:", givenparkName);
    return;
  }

  let today = new Date().toLocaleDateString("en-CA", {
    timeZone: timeZone
  });

  const cacheKey = `${parkId}_${today}`;

  //Use cache if available
  if (parkHoursCache[cacheKey]?.version === 2 && Date.now() - parkHoursCache[cacheKey].fetchedAt < 15 * 60 * 1000) {
    const cached = parkHoursCache[cacheKey];
    setParkHours(
      cached.earlyEntry,
      cached.open,
      cached.close,
      cached.extOpen,
      cached.extClose,
      cached.events
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.themeparks.wiki/v1/entity/${parkId}/schedule`
    );

    if (!response.ok) throw new Error(response.status);
    const data = await response.json();

    if (!Array.isArray(data.schedule)) return;

    const todaySchedules = data.schedule.filter(
      item => item.date === today
    );

    if (!todaySchedules.length) return;

    const operating = todaySchedules.find(
      item => item.type === "OPERATING"
    );

    const earlyEntry = todaySchedules.find(
      item =>
        item.type === "TICKETED_EVENT" &&
        item.description?.toLowerCase().includes("early")
    );

    const extended = todaySchedules.find(
      item =>
        item.type === "TICKETED_EVENT" &&
        item.description?.toLowerCase().includes("extended")
    );
    if (!operating) return;
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timeZone
    });

    const payload = {
      version: 2,
      fetchedAt: Date.now(),
      events: ['usfl', 'usHollywood'].includes(givenparkName) ? todaySchedules
        .filter(item => ['TICKETED_EVENT', 'INFO'].includes(item.type) && /halloween horror nights|\bhhn\b/i.test(item.description || ''))
        .map(item => ({ description: item.description, open: formatParkEventTime(item.openingTime), close: formatParkEventTime(item.closingTime) }))
        .filter(event => event.open && event.close) : [],
      earlyEntry: earlyEntry
        ? formatter.format(new Date(earlyEntry.openingTime))
        : "N/A",
      open: formatter.format(new Date(operating.openingTime)),
      close: formatter.format(new Date(operating.closingTime)),
      extOpen: extended
        ? formatter.format(new Date(extended.openingTime))
        : null,
      extClose: extended
        ? formatter.format(new Date(extended.closingTime))
        : null
    };

    //Cache it
    parkHoursCache[cacheKey] = payload;
    localStorage.setItem(
      "parkHoursCache",
      JSON.stringify(parkHoursCache)
    );

    if (request !== parkHoursRequest) return;
    setParkHours(
      payload.earlyEntry,
      payload.open,
      payload.close,
      payload.extOpen,
      payload.extClose,
      payload.events
    );

  } catch (err) {
    console.error("Park hours error:", err);
  }
}

/*************************
 * SET PARK HOURS (UI)
 *************************/
function setParkHours(
  earlyEntry,
  open,
  close,
  extOpen = null,
  extClose = null,
  events = []
) {

  const earlyEntryEl = document.querySelector(".early-entry");
  const openHoursEl = document.querySelector(".open-hours");
  const extendedEl = document.querySelector(".ext-hours");
  setParkEventHours(events);

  if(earlyEntryEl && earlyEntry){
    earlyEntryEl.textContent = `Early Entry: ${earlyEntry}`;
  }
  
  openHoursEl.textContent = `Open: ${open} – ${close}`;

   if(extendedEl){
    if (extendedEl) {
    extendedEl.textContent =
      extOpen && extClose
        ? `Extended Evening: ${extOpen} – ${extClose}`
        : "";
  }
  }

}

/*************************
 * OPTIONAL: CLEAN OLD CACHE
 *************************/
(function cleanupOldCache() {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: timeZone
  });

  Object.keys(parkHoursCache).forEach(key => {
    if (!key.endsWith(today)) delete parkHoursCache[key];
  });

  localStorage.setItem(
    "parkHoursCache",
    JSON.stringify(parkHoursCache)
  );
})();
