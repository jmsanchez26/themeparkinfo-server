/********************************
 * Dependencies
 ********************************/
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// If using Node < 18, uncomment this:
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
  wdw: process.env.WDW_API,
  usorlando: process.env.USORLANDO_API
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
let cache = {};

Object.keys(API_URLS).forEach(park => {
  cache[park] = {
    data: null,
    lastUpdated: null,
    error: null
  };
});

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

      // Keep old cached data but mark error
      cache[park].error = err.message;
    }
  }
}

// Initial fetch
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

  // No data ever loaded
  if (!cache[park].data) {
    return res.status(503).json({
      error: true,
      message: "Live data unavailable",
      data: { liveData: [] }
    });
  }

  // API temporarily failing but we have cache
  if (cache[park].error) {
    return res.json({
      warning: true,
      message: "Using cached data (API temporarily unavailable)",
      lastUpdated: cache[park].lastUpdated,
      data: cache[park].data
    });
  }

  // Normal success
  res.json({
    lastUpdated: cache[park].lastUpdated,
    data: cache[park].data
  });
});

/********************************
 * Health Check Route
 ********************************/
app.get("/test", (req, res) => {
  res.send("SERVER IS WORKING");
});

/********************************
 * Serve Frontend (IMPORTANT FIX)
 ********************************/

// Serve static files from public folder
app.use(express.static(path.join(__dirname, "../public")));

// Fallback route for SPA / PWA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});
/********************************
 * Start Server
 ********************************/
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});