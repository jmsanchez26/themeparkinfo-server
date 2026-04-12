/*************************
 * SEARCH
 *************************/
document.addEventListener("input", e => {
  if (!e.target.classList.contains("card-search")) return;

  applySearchFilter(e.target.closest(".card-wrapper"));
});

function applySearchFilter(cardWrapper) {
  if (!cardWrapper) return;

  const input = cardWrapper.querySelector(".card-search");
  const list = cardWrapper.querySelector(".card-list");
  if (!input || !list) return;

  const term = input.value.toLowerCase().trim();

  list.querySelectorAll(".wait-card").forEach(card => {
    const name = card.querySelector("h3").textContent.toLowerCase();
    card.style.display = !term || name.includes(term) ? "block" : "none";
  });
}
/*************************
 * Sort
 *************************/

function sortParkData(parkKey, type, criterion) {
  const data = parks[parkKey][type];
  if (!Array.isArray(data)) return;

  if (criterion === "default") {
    data.sort((a, b) => {
      const aOrder = typeof a.defaultOrder === "number" ? a.defaultOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.defaultOrder === "number" ? b.defaultOrder : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
    return;
  }

  data.sort((a, b) => {
    if (criterion === "name") {
      return a.name.localeCompare(b.name);
    } 
    
    if (criterion === "waitTime") {
      const waitA = typeof a.waitTime === "number" ? a.waitTime : 999;
      const waitB = typeof b.waitTime === "number" ? b.waitTime : 999;
      if (waitA !== waitB) return waitA - waitB;
      return a.name.localeCompare(b.name);
    }

    if (criterion === "status") {
      const statusA = a.status?.toLowerCase() === "operating" ? 0 : 1;
      const statusB = b.status?.toLowerCase() === "operating" ? 0 : 1;
      if (statusA !== statusB) return statusA - statusB;
      return a.name.localeCompare(b.name);
    }
    return 0;
  });
}
document.addEventListener("change", (e) => {
  if (!e.target.classList.contains("card-sort")) return;

  const criterion = e.target.value;
  const parkContainer = e.target.closest(".park-content");
  if (!parkContainer) return;
  const parkId = parkContainer.id; // e.g., "magic-kingdom"
  
  const parkKey = idToKey[parkId];
  if (!parkKey) return;
  const activeSubTab = parkContainer.querySelector(".sub-tab.active").getAttribute("data-type");
  const wrapper = parkContainer.querySelector(`.card-wrapper[data-type="${activeSubTab}"]`);
  const selector = `#${parkId} .card-wrapper[data-type="${activeSubTab}"] .card-list`;

  // Apply sort and re-render the specific section
  sortParkData(parkKey, activeSubTab, criterion);
  renderCards(parkKey, activeSubTab, selector);
  applySearchFilter(wrapper);
});
