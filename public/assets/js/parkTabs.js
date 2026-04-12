/*************************
 * TABS
 *************************/
function initParkTabs() {
  const tabs = document.querySelectorAll(".park-tab");
  const contents = document.querySelectorAll(".park-content");

  function activateParkTab(target) {
    if (!target) return;

    tabs.forEach(t => t.classList.toggle("active", t.dataset.park === target));
    contents.forEach(c => c.classList.toggle("active", c.id === target));
    getParkHours(target);
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      activateParkTab(tab.dataset.park);
    });
  });

  const requestedPark = new URLSearchParams(window.location.search).get("park");
  if (requestedPark && document.getElementById(requestedPark)) {
    activateParkTab(requestedPark);
  }
}

/*************************
 * SUB TABS (Rides / Shows / Restaurants)
 *************************/
function initSubTabs() {
  const parkContents = document.querySelectorAll(".park-content");

  parkContents.forEach(park => {
    const tabs = park.querySelectorAll(".sub-tab");
    const wrappers = park.querySelectorAll(".card-wrapper");

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const type = tab.dataset.type;

        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        wrappers.forEach(w => {
          w.classList.toggle("active", w.dataset.type === type);
        });
      });
    });
  });
}
