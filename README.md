# ParkWaitTimes

Run the website locally without park API keys:

```powershell
cd backend
npm ci
npm start
```

Open http://localhost:3000 in your browser. When a park's upstream setting is missing, a non-production server reads that park's public data from the existing Render API. The private upstream keys remain on Render. Initial loading may take longer if Render needs to wake up. Your local site still serves your local code, and browser alerts/favorites remain local.

Production does not use this fallback. Set `NODE_ENV=production` on Render and keep its existing park API settings. For local upstream-only development, set `USE_HOSTED_PARK_DATA=false`. Configured park API URLs always take precedence.

This fallback is read-only park data. It does not proxy private alerts, notification tokens or Firebase credentials. Android push testing still needs the updated deployed backend and real Firebase configuration; iOS currently uses local in-app alerts. See [security rollout notes](security-audit/REMEDIATION.md).
