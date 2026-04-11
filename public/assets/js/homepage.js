(function () {
  const baseUrl = window.__API_BASE__ || "";
  const endpoints = [
    { label: "Walt Disney World", url: `${baseUrl}/api/wdw` },
    { label: "Disneyland Resort", url: `${baseUrl}/api/disneyland` },
    { label: "Universal Orlando", url: `${baseUrl}/api/usOrlando` },
    { label: "Universal Hollywood", url: `${baseUrl}/api/hollywood` }
  ];

  const parkNames = {
    "75ea578a-adc8-4116-a54d-dccb60765ef9": "Magic Kingdom",
    "47f90d2c-e191-4239-a466-5892ef59a88b": "EPCOT",
    "1c84a229-8862-4648-9c71-378ddd2c7693": "Animal Kingdom",
    "288747d1-8b4f-4a64-867e-ea7c9b27bad8": "Hollywood Studios",
    "7340550b-c14d-4def-80bb-acdb51d49a66": "Disneyland Park",
    "832fcd51-ea19-4e77-85c7-75d5843b127c": "California Adventure",
    "eb3f4560-2383-4a36-9152-6b3e5ed6bc57": "Universal Studios Florida",
    "267615cc-8943-4c2a-ae2c-5da728ca591f": "Islands of Adventure",
    "12dbb85b-265f-44e6-bccf-f1faa17211fc": "Epic Universe",
    "fe78a026-b91b-470c-b906-9d2266b692da": "Volcano Bay",
    "bc4005c5-8c7e-41d7-b349-cdddf1796427": "Universal Studios Hollywood"
  };

  const eventKeywords = ["parade", "cavalcade", "fireworks", "fantasmic", "nighttime", "spectacular"];

  function formatParkLabel(parkId, resortLabel) {
    return parkNames[parkId] || resortLabel;
  }

  function formatTime(isoString) {
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return "TBD";

    return parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function renderFeaturedRide(ride) {
    const featuredCard = document.getElementById("featuredRideCard");
    if (!featuredCard) return;

    if (!ride) {
      featuredCard.innerHTML = `
        <span class="tag">No live waits yet</span>
        <h3>Check back soon</h3>
        <p>We could not find a live ride wait just now.</p>
        <strong>--</strong>
      `;
      return;
    }

    featuredCard.innerHTML = `
      <span class="tag">${ride.park}</span>
      <h3>${ride.name}</h3>
      <p>Lowest current standby wait</p>
      <strong>${ride.waitTime} min</strong>
    `;
  }

  function renderLowestWaits(rides) {
    const container = document.getElementById("lowestWaitsList");
    if (!container) return;

    if (!rides.length) {
      container.innerHTML = `<div class="empty-state">No live ride waits are available right now.</div>`;
      return;
    }

    container.innerHTML = rides.slice(0, 6).map(ride => `
      <div class="attraction-card">
        <div>
          <h3>${ride.name}</h3>
          <p>Lowest wait right now</p>
          <span class="park-label">${ride.park}</span>
        </div>
        <span class="wait ${ride.waitTime <= 20 ? "low" : ride.waitTime >= 50 ? "high" : ""}">${ride.waitTime} min</span>
      </div>
    `).join("");
  }

  function renderEvents(events) {
    const container = document.getElementById("paradeEventsList");
    if (!container) return;

    if (!events.length) {
      container.innerHTML = `<div class="empty-state">No parade or nighttime show times are available right now.</div>`;
      return;
    }

    container.innerHTML = events.slice(0, 6).map(event => `
      <div class="event-card">
        <div>
          <h3>${event.name}</h3>
          <p>Next upcoming time</p>
          <span class="event-park">${event.park}</span>
        </div>
        <span class="event-time">${formatTime(event.time)}</span>
      </div>
    `).join("");
  }

  function extractLowestWaits(payload, resortLabel) {
    const liveData = payload?.data?.liveData || [];

    return liveData
      .filter(item => item.entityType === "ATTRACTION")
      .map(item => ({
        name: item.name,
        waitTime: item.queue?.STANDBY?.waitTime,
        park: formatParkLabel(item.parkId, resortLabel),
        status: String(item.status || "")
      }))
      .filter(item => item.status.toLowerCase() === "operating" && typeof item.waitTime === "number")
      .sort((a, b) => a.waitTime - b.waitTime);
  }

  function extractEvents(payload, resortLabel) {
    const liveData = payload?.data?.liveData || [];
    const now = Date.now();

    return liveData
      .filter(item => item.entityType === "SHOW" && Array.isArray(item.showtimes) && item.showtimes.length)
      .filter(item => eventKeywords.some(keyword => item.name.toLowerCase().includes(keyword)))
      .map(item => {
        const nextShow = item.showtimes
          .map(show => show.startTime)
          .filter(Boolean)
          .map(time => new Date(time))
          .filter(time => !Number.isNaN(time.getTime()) && time.getTime() >= now)
          .sort((a, b) => a - b)[0];

        if (!nextShow) return null;

        return {
          name: item.name,
          park: formatParkLabel(item.parkId, resortLabel),
          time: nextShow.toISOString()
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  async function loadHomepageData() {
    try {
      const results = await Promise.all(
        endpoints.map(async endpoint => {
          const response = await fetch(endpoint.url, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`Could not load ${endpoint.label}`);
          }

          return {
            endpoint,
            payload: await response.json()
          };
        })
      );

      const rides = results
        .flatMap(({ endpoint, payload }) => extractLowestWaits(payload, endpoint.label))
        .sort((a, b) => a.waitTime - b.waitTime);

      const events = results
        .flatMap(({ endpoint, payload }) => extractEvents(payload, endpoint.label))
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      renderFeaturedRide(rides[0]);
      renderLowestWaits(rides);
      renderEvents(events);
    } catch (error) {
      console.error("Homepage live data failed:", error);
      renderFeaturedRide(null);
      renderLowestWaits([]);
      renderEvents([]);
    }
  }

  document.addEventListener("DOMContentLoaded", loadHomepageData);
})();
