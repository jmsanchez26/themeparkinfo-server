

/*************************
 * ALERT MODAL
 *************************/
function openSetAlertModal(item) {
  const modal = document.querySelector(".waitTimeAlertModal");

  modal.innerHTML = `
    <div class="modalInner">
      <h3>${item.name}</h3>
      <p>Current wait: ${item.waitTime} min</p>

      <label>Alert me when wait time is</label>
      <input type="number" id="alertValue" placeholder="Minutes" />

      <div class="modalActions">
        <button id="closeModalBtn">Cancel</button>
        <button id="saveAlertBtn">Save</button>
      </div>
    </div>
  `;

  modal.style.display = "flex";

  document.getElementById("closeModalBtn").onclick = () => modal.style.display = "none";
  document.getElementById("saveAlertBtn").onclick = () => {
    const value = parseInt(document.getElementById("alertValue").value, 10);
    if (!value) return;

    waitTimeAlerts.push({
      name: item.name,
      waitTime: value
    });

    localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
    modal.style.display = "none";
  };
}


/*************************
 * CHECK ALERTS
 *************************/
function checkAlerts(park) {
  if (!waitTimeAlerts.length) return;

  // Build allItems based on the park
  let allItems = [];

  if (park === "wdw") {
    allItems = [
      ...parks.mg.rides, ...parks.mg.shows, ...parks.mg.res,
      ...parks.epcot.rides, ...parks.epcot.shows, ...parks.epcot.res,
      ...parks.ak.rides, ...parks.ak.shows, ...parks.ak.res,
      ...parks.hollywood.rides, ...parks.hollywood.shows, ...parks.hollywood.res
    ];
  } else if (park === "usOrlando") { // Replace with correct park key
    allItems = [
      ...parks.usfl.rides, ...parks.usfl.shows,
      ...parks.epic.rides, ...parks.epic.shows,
      ...parks.islandofAdventure.rides, ...parks.islandofAdventure.shows,
      ...parks.volcanoBay.rides
    ];
  } else if (park === "disneyland") { // Replace with correct park key
    allItems = [
      ...parks.disneyland.rides, ...parks.disneyland.shows, ...parks.disneyland.res,
      ...parks.caliadv.rides, ...parks.caliadv.shows, ...parks.caliadv.res
    ];
  } else if (park === "usHollywood") { // Replace with correct park key
    allItems = [
      ...parks.usHollywood.rides, ...parks.usHollywood.shows
    ];
  }



  const triggered = [];

  waitTimeAlerts.forEach(alert => {
    const match = allItems.find(i => i.name === alert.name);
    if (!match) return;

    const statusLower = match.status?.toLowerCase();
    const hasWait = typeof match.waitTime === "number";

    if (
      (statusLower === "operating" && hasWait && match.waitTime <= alert.waitTime) ||
      (statusLower !== "operating")
    ) {
      triggered.push({
        ...match,
        alertWait: alert.waitTime,
        isDown: statusLower !== "operating"
      });
    }
  });

  if (triggered.length) {
    waitTimeAlerts = waitTimeAlerts.filter(
      a => !triggered.some(t => t.name === a.name)
    );
    localStorage.setItem("waitTimeAlerts", JSON.stringify(waitTimeAlerts));
    openTriggeredModal(triggered);
  }
}


/*************************
 * TRIGGERED MODAL
 *************************/
function openTriggeredModal(alerts) {
  const modal = document.querySelector(".waitTimeAlertModal");
  if (!modal) return;

  modal.innerHTML = `
    <div class="modalInner">
      <h2>Wait Time Alerts</h2>

      ${alerts.map(a => `
        <div class="alertBlock">
          <strong>${a.name}</strong>
          ${
            a.isDown
              ? `<p class="alert-down">Status: Currently Down</p>`
              : `<p>Now: ${a.waitTime} min (alert: ${a.alertWait} min)</p>`
          }
        </div>
      `).join("")}

      <button id="closeModalBtn">OK</button>
    </div>
  `;

  modal.style.display = "flex";

  document.getElementById("closeModalBtn").onclick = () => {
    modal.style.display = "none";
  };
}

document.addEventListener("click", e => {
  const header = e.target.closest(".addInfo-header");
  if (!header) return;

  header.parentElement.classList.toggle("open");
});
