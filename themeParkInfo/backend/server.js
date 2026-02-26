/********************************
 * Dependencies
 ********************************/
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// If using Node < 18, uncomment the next line:
// const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

/********************************
 * Middleware
 ********************************/
app.use(cors());
app.use(express.json());

/********************************
 * External API URLs (from .env)
 ********************************/
const API_URLS = {
  disneyland: process.env.DISNEYLAND_API,
  hollywood: process.env.HOLLYWOOD_API,
  wdw: process.env.WDW_API
};

// Warn if any environment variable is missing
for (const park in API_URLS) {
  if (!API_URLS[park]) {
    console.warn(`⚠ WARNING: Missing API URL for ${park}`);
  }
}

/********************************
 * In-Memory Cache
 ********************************/
let cache = {
  disneyland: { data: null, lastUpdated: null },
  hollywood: { data: null, lastUpdated: null },
  wdw: { data: null, lastUpdated: null }
};

/********************************
 * Fetch & Cache Park Data
 ********************************/
async function updateCache() {
  console.log("🔄 Updating park caches...");

  for (const park in API_URLS) {
    try {
      if (!API_URLS[park]) continue;

      const response = await fetch(API_URLS[park]);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      cache[park].data = data;
      cache[park].lastUpdated = new Date();
      cache[park].error = null;

      console.log(`✅ ${park} updated at ${cache[park].lastUpdated}`);
    } catch (err) {
      console.error(`❌ Error updating ${park}:`, err.message);

      // Keep old data, just mark error
      cache[park].error = err.message;
    }
  }
}

// Initial fetch on startup
updateCache();

// Refresh every 30 seconds
setInterval(updateCache, 30000);

/********************************
 * API Route
 ********************************/
app.get("/api/:park", (req, res) => {
  const park = req.params.park.toLowerCase();

  console.log(`📡 API request for: ${park}`);

  if (!cache[park]) {
    return res.status(404).json({
      error: true,
      message: "Park not found"
    });
  }

  // If no data has EVER loaded
  if (!cache[park].data) {
    return res.status(503).json({
      error: true,
      message: "Live data unavailable",
      data: { liveData: [] }
    });
  }

  // If we have data but last fetch failed
  if (cache[park].error) {
    return res.json({
      warning: true,
      message: "Using cached data (API temporarily unavailable)",
      lastUpdated: cache[park].lastUpdated,
      data: cache[park].data
    });
  }

  // Normal case
  res.json({
    lastUpdated: cache[park].lastUpdated,
    data: cache[park].data
  });
});

/********************************
 * Test Route
 ********************************/
app.get("/test", (req, res) => {
  res.send("SERVER IS WORKING");
});

/********************************
 * Serve Frontend (public folder)
 ********************************/
app.use(express.static(path.join(__dirname, "../public")));

/********************************
 * Start Server
 ********************************/
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://127.0.0.1:${PORT}`);
});