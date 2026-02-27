/*************************
 * PARK HOURS CACHE
 *************************/

const parkHoursCache =
  JSON.parse(localStorage.getItem("parkHoursCache")) || {};

/*************************
 * GET PARK HOURS (CACHED)
 *************************/
async function getParkHours(givenparkName) {
  
  // Normalize incoming names
  if (givenparkName === "magic-kingdom") givenparkName = "mg";
  else if (givenparkName === "animalKingdom") givenparkName = "ak";

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
  if (parkHoursCache[cacheKey]) {
    const cached = parkHoursCache[cacheKey];
    setParkHours(
      cached.earlyEntry,
      cached.open,
      cached.close,
      cached.extOpen,
      cached.extClose
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

    setParkHours(
      payload.earlyEntry,
      payload.open,
      payload.close,
      payload.extOpen,
      payload.extClose
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
  extClose = null
) {

  const earlyEntryEl = document.querySelector(".early-entry");
  const openHoursEl = document.querySelector(".open-hours");
  const extendedEl = document.querySelector(".ext-hours");

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
