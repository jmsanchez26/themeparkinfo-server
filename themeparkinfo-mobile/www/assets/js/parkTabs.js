/*************************
 * TABS
 *************************/
function initParkTabs() {
  const tabs = document.querySelectorAll(".park-tab");
  const contents = document.querySelectorAll(".park-content");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.park;

      tabs.forEach(t => t.classList.remove("active"));
      contents.forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(target)?.classList.add("active");

      getParkHours(target);
    });
  });
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
