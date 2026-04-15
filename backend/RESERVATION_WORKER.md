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

The worker architecture is live, but the provider checkers are still placeholders:

- `providers/disneyDiningChecker.js`
- `providers/universalDiningChecker.js`

Those files are where Playwright-based reservation checking lives.

- `providers/disneyDiningChecker.js`
  - now uses Playwright to open the Disney dining availability flow
  - logs in through the Disney OneID iframe using environment credentials
  - reuses a saved browser storage state when available
  - searches the page for matching reservation times inside the requested window

- `providers/universalDiningChecker.js`
  - still a placeholder

## Why this split is safer

- the API stays responsive even if reservation checks are slow
- duplicate user watches can be collapsed into one check
- worker concurrency can be limited
- retry / cooldown logic stays out of request handlers

## Files used by the worker

- `data/reservation-alerts.json`
- `data/reservation-query-cache.json`

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
- `DISNEY_LOGIN_EMAIL`
  - required for Disney reservation checks
- `DISNEY_LOGIN_PASSWORD`
  - required for Disney reservation checks
- `DISNEY_PLAYWRIGHT_STORAGE_STATE`
  - optional path for the saved Disney login session
  - default: `backend/data/disney-<provider>-storage-state.json`
- `DISNEY_CHECK_TIMEOUT_MS`
  - optional timeout override for the Disney checker
- `PLAYWRIGHT_CHANNEL`
  - optional
  - default: `chromium`
- `PLAYWRIGHT_HEADFUL`
  - set to `true` if you want to watch the Disney checker in a visible browser while debugging

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
