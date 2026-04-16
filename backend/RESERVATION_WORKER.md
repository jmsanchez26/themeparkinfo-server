# Reservation Worker

This project now supports a separate dining reservation worker process.

## What runs where

- `server.js`
  - serves the API and web app
  - stores ride alerts
  - stores restaurant alert settings
  - handles ride wait push notifications

- `reservation-worker.js`
  - runs every 15 minutes by default
  - reads saved restaurant alerts
  - groups identical checks together
  - runs provider-specific reservation checkers
  - sends push notifications for new matches

## Current state

The worker architecture is live.

- `providers/disneyDiningChecker.js`
  - now uses Playwright to open the Disney dining availability flow
  - logs in through the Disney OneID iframe using environment credentials
  - reuses a persistent browser profile between runs when available
  - searches the page for matching reservation times inside the requested window

- `providers/universalDiningChecker.js`
  - still a placeholder

## Why this split is safer

- the API stays responsive even if reservation checks are slow
- duplicate user watches can be collapsed into one check
- worker concurrency can be limited
- retry / cooldown logic stays out of request handlers

## Files used by the worker

- `data/reservation-query-cache.json`

When `RESERVATION_API_BASE_URL` is set, the worker reads reservation alerts from the API instead of local JSON files. This is the recommended setup when the API and worker run as separate Render services.

## Suggested deployment

### Main API service

Run:

```powershell
npm start
```

### Reservation worker service

Run:

```powershell
npm run start:reservation-worker
```

## Useful env vars

- `RESERVATION_CHECK_INTERVAL_MS`
  - default: `900000` (15 minutes)
- `RESERVATION_NOTIFICATION_COOLDOWN_MS`
  - default: `21600000` (6 hours)
- `RESERVATION_WORKER_CONCURRENCY`
  - default: `3`
- `RESERVATION_API_BASE_URL`
  - recommended when the worker runs separately from the API
  - example: `https://themeparkinfo-api.onrender.com`
- `RESERVATION_WORKER_SHARED_SECRET`
  - optional but recommended
  - use the same value on the API service and the worker so the worker can update alert status safely
- `DISNEY_LOGIN_EMAIL`
  - required for Disney reservation checks
- `DISNEY_LOGIN_PASSWORD`
  - required for Disney reservation checks
- `DISNEY_PLAYWRIGHT_STORAGE_STATE`
  - old session-state option
  - no longer the preferred path
- `DISNEY_PLAYWRIGHT_USER_DATA_DIR`
  - optional base path for the persistent Disney browser profile
  - if set, the checker will create one profile per provider under this path
  - example: `/opt/render/project/src/backend/data/disney-profiles`
- `DISNEY_CHECK_TIMEOUT_MS`
  - optional timeout override for the Disney checker
- `PLAYWRIGHT_CHANNEL`
  - optional
  - default: `chromium`
- `PLAYWRIGHT_HEADFUL`
  - set to `true` if you want to watch the Disney checker in a visible browser while debugging

## Session note

If Disney is sending a security code on every worker run, a persistent browser profile usually helps more than a one-off storage state file.

If you want that browser profile to survive Render restarts and redeploys, attach a persistent disk to the worker and point `DISNEY_PLAYWRIGHT_USER_DATA_DIR` at a folder on that disk.

## Next implementation step

The next biggest step is expanding the checkers so they can parse Disney and Universal results more precisely and support more resilient selectors. The worker already expects provider results in this shape:

```json
{
  "available": true,
  "matches": [
    {
      "restaurant": "Space 220 Lounge",
      "date": "2026-04-20",
      "time": "17:10"
    }
  ],
  "source": "playwright"
}
```
