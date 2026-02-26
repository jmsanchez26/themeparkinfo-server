const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = 3000;

/********************************
 * Test Route
 ********************************/
app.get("/test", (req, res) => {
  res.send("SERVER IS WORKING");
});

/********************************
 * Middleware
 ********************************/
app.use(cors());
app.use(express.json());

/********************************
 * External API URLs
 ********************************/
const API_URLS = {
  disneyland: process.env.DISNEYLAND_API,
  hollywood: process.env.HOLLYWOOD_API,
  wdw: process.env.WDW_API
};

// Safety check for missing env variables
for (const park in API_URLS) {
  if (!API_URLS[park]) {
    console.warn(`⚠ WARNING: Missing API URL for ${park}`);
  }
}

/********************************
 * Cache Object
 ********************************/
let cache = {
  disneyland: { data: null, lastUpdated: null },
  hollywood: { data: null, lastUpdated: null },
  wdw: { data: null, lastUpdated: null }
};

/********************************
 * Fetch & Cache All Parks
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

      console.log(`✅ ${park} updated at ${cache[park].lastUpdated}`);
    } catch (err) {
      console.error(`❌ Error updating ${park}:`, err.message);
    }
  }
}

// Initial fetch
updateCache();

// Refresh every 30 seconds
setInterval(updateCache, 30000);

/********************************
 * API Route (MUST come before static)
 ********************************/
app.get("/api/:park", (req, res) => {
  const park = req.params.park;

  console.log(`📡 API request for: ${park}`);

  if (!cache[park]) {
    return res.status(404).json({ message: "Park not found" });
  }

  if (!cache[park].data) {
    return res.status(503).json({ message: "Data not ready yet" });
  }

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