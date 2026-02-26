/*************************
 * SEARCH
 *************************/
document.addEventListener("input", e => {
  if (!e.target.classList.contains("card-search")) return;

  const term = e.target.value.toLowerCase();
  const list = e.target.closest(".card-wrapper").querySelector(".card-list");

  list.querySelectorAll(".wait-card").forEach(card => {
    const name = card.querySelector("h3").textContent.toLowerCase();
    card.style.display = name.includes(term) ? "block" : "none";
  });
});
/*************************
 * Sort
 *************************/

function sortParkData(parkKey, type, criterion) {
    
  const data = parks[parkKey][type];
    console.log(data)

  console.log(criterion === "default")

  if (criterion === "default") {
    // If you want to return to the original API order, 
    // it's best to simply re-fetch or use a stored copy.
    // For a quick fix, we can just call the render again:
    getParkData(); 
    return;
  }

  data.sort((a, b) => {
    if (criterion === "name") {
      return a.name.localeCompare(b.name);
    } 
    
    if (criterion === "waitTime") {
      const waitA = typeof a.waitTime === "number" ? a.waitTime : 999;
      const waitB = typeof b.waitTime === "number" ? b.waitTime : 999;
      return waitA - waitB;
    }

    if (criterion === "status") {
      const statusA = a.status?.toLowerCase() === "operating" ? 0 : 1;
      const statusB = b.status?.toLowerCase() === "operating" ? 0 : 1;
      return statusA - statusB;
    }
    return 0;
  });
}
document.addEventListener("change", (e) => {
  if (!e.target.classList.contains("card-sort")) return;

  const criterion = e.target.value;
  const parkContainer = e.target.closest(".park-content");
  const parkId = parkContainer.id; // e.g., "magic-kingdom"
  
  const parkKey = idToKey[parkId];
  const activeSubTab = parkContainer.querySelector(".sub-tab.active").getAttribute("data-type");
  const selector = `#${parkId} .card-wrapper[data-type="${activeSubTab}"] .card-list`;

  // Apply sort and re-render the specific section
  sortParkData(parkKey, activeSubTab, criterion);
  renderCards(parkKey, activeSubTab, selector);
});
