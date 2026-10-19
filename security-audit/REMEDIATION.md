# Security fixes and rollout

Implemented October 18, 2026. This describes the current source; REPORT.md records the pre-fix audit.

## What changed

- Alerts use a cryptographically random per-installation bearer credential. The backend stores only its SHA-256 hash and scopes every read/update/delete to that identity. Push tokens are absent from alert responses and request URLs.
- Before creating server push alerts, the app must receive a short-lived, one-use secret through Firebase push and return it with the same private identity. Merely knowing an old exposed push token cannot bind it. Verification is rate limited and pending requests are bounded. Token rotation updates that identity's alerts; verified reassociation revokes the prior owner.
- Alert creation uses a supported upstream attraction ID and its server-selected name, strict whole-number thresholds (0–300), bounded input, 50 alerts per owner, and global storage limits. Updating the same alert does not repeatedly reset push delivery.
- Ride/alert names are escaped as plain text, and all dynamic HTML insertion in website/mobile scripts goes through locally bundled DOMPurify. CSP disables inline scripts and handlers. Map frame targets and the Capacitor internal HTTP proxy path receive additional checks. Authentication is sent only as an Authorization header.
- Server adds Helmet headers, an origin allowlist, request limits, generic error responses and upstream timeouts. Push token and alert-preference logging were removed.
- The new secure-alerts.json store serializes changes and atomically replaces its file, exposing state only after a successful write. Corrupt stores fail closed. Private data expires after 30 days; cleanup runs on startup, writes and hourly. The old unowned alerts.json is removed at server startup. No insecure ownership migration is attempted.
- Android backups/device transfer are excluded; FileProvider roots are narrowed. Capacitor's messaging service now handles foreground push delivery instead of the competing custom service. Firebase automatic initialization is disabled by default and registration occurs after a user asks to save an alert. Delete-all removes server records and unregisters push.
- Capacitor Android/iOS/core/CLI are updated to 8.5.1; iOS Swift package is also synced to 8.5.1. Firebase Admin is updated to 14.5.0. Compatible dependency fixes plus scoped qs/UUID overrides remove the reported npm advisories. xcode uses UUID v4, which is supported by the replacement UUID version.
- Both platforms include a delete-all control. Browser/iOS alerts are local; Android uses the verified push API.

## Deploy in this order

1. Install with Node 22+ and `npm ci` in backend. Use the committed lockfile. Set existing park API URLs and FIREBASE_SERVICE_ACCOUNT_JSON securely in the hosting environment.
2. Store backend/data on a private persistent disk. This JSON store supports one Node process only; do not run multiple replicas sharing or independently writing it. Use a transactional database before scaling horizontally. Ensure only the service account can read the data directory.
3. Set ALLOWED_ORIGINS to any additional legitimate website origins, separated by commas. Defaults include the current Render origin and Capacitor localhost origins.
4. If the hosting edge forwards client IPs, set TRUST_PROXY_HOPS to the exact trusted hop count after checking the provider configuration. Default is 0 (no proxy trust); multiple users may otherwise share a rate-limit bucket. Never trust arbitrary forwarding headers or set unlimited proxy trust. Add edge abuse protection for larger deployments.
5. Deploy/restart the updated server FIRST. Old clients will receive an update-required 401 for private alerts, while public wait-time endpoints remain available. The legacy unowned alerts file is deleted at startup. Users need to recreate their old server alerts. Its previously exposed tokens cannot be made secret again; the new delivery-proof requirement prevents ownership from being established by token knowledge alone. Remove historic token-bearing logs/backups according to your retention requirements and inspect for abuse.
6. In themeparkinfo-mobile run `npm ci`, then `npx cap sync`, rebuild Android and iOS, and distribute fresh builds. Web-only updates do not patch the native runtime. iOS compilation/signing must run on the cloud Mac build service or a Mac. Do not ship an earlier native binary with these web files and assume the runtime vulnerability is fixed.
7. On a real Android device with Firebase configured, keep the app foregrounded while saving the first alert. Verify the silent delivery challenge completes, the ride alert triggers, another installation sees no private alerts, token rotation works, and delete-all removes records and unregisters push. Background delivery, notification taps, real Firebase credentials and device behavior require this smoke test.

## iOS behavior

The existing iOS plugin exposes APNs tokens, while this server sends through Firebase Cloud Messaging. The project has no Firebase Messaging iOS integration that converts/registers these tokens. This fix uses the existing local in-app alert behavior on iOS instead of sending an incompatible token to Firebase. Alerts can be saved, edited and removed locally and checked while a park page is open. Background iOS push is not implemented or validated here. A future feature should add an APNs sender or a supported iOS Firebase token integration, and equivalent delivery-proof verification. The alerts page states this limitation.

## Checks

`cd backend` then `npm test` runs actual HTTP route tests with synthetic data, push-proof tests, ownership isolation, invalid input/body bounds, rate limits, atomic write rollback/concurrency/retention tests, real renderer sanitization checks and header/CORS checks. No production API requests or notifications are used. `node security-audit/verify.cjs` runs the same regression suite from the repository root.

After dependency changes, `npm audit --omit=dev` in backend and themeparkinfo-mobile reported zero known vulnerabilities. Advisory databases change; rerun during releases. Dependency scans do not prove absence of all vulnerabilities.

Validation completed: all 11 regression tests pass; Capacitor sync succeeds for Android and iOS; Android assembleDebug succeeds using Android Studio's JDK. iOS was synced but not compiled on this Windows machine. The dependency JSON files named backend-dependencies.json and mobile-dependencies.json preserve the original pre-fix advisory results.

## Remaining operational checks

Review Render/Firebase/Codemagic/Apple access, MFA, API-key permissions, cloud logs/backups, Git history for old secrets, release binary permissions/WebView debugging and actual data disclosures. This patch does not inspect or change those accounts or deploy itself. TLS is required for deployed traffic. Credentials in app localStorage are protected by the app origin and new rendering/CSP protections; a rooted device or a future app-origin compromise can still expose them. There is no account recovery/cross-device sync for anonymous alert identities.
