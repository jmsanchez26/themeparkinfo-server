# ThemeParkInfo security and privacy audit

Historical pre-fix report. See REMEDIATION.md for subsequent source changes, verification and rollout requirements.

Date: October 18, 2026. Scope: current local backend, public website, Capacitor web assets, Android/iOS native configuration and code, npm production dependency graphs, and current tracked-file inventory.

## Decision

Fix the alert API access controls, stored HTML injection, and vulnerable Capacitor runtime before distributing to testers. The current source permits cross-user disclosure and modification. This audit found vulnerabilities, not evidence of a past compromise.

## Method and limits

Read route handlers, frontend rendering/network/storage code, native permissions, notification handlers, build configuration, and credential handling. Ran `node security-audit/verify.cjs` against real route handlers with mocked persistence, synthetic tokens and no real server. The script confirms unauthorized create/read/update/delete and raw HTML propagation into the real mobile renderer. It does not execute the HTML in an actual WebView. Ran npm's online advisory checks for both projects; full JSON results are saved beside this report. A nonzero npm audit exit means advisories were found.

No requests were sent to the deployed app, no real alert records were fetched, no notifications were sent, and application behavior was not changed. No load testing, binary analysis, simulator/device penetration test, packet capture, full historical Git secret scan, or hosting/Apple/Firebase/Codemagic account inspection was performed. Production reverse-proxy protections, deployed revision, cloud encryption, access logs, account permissions and signing-key handling remain unverified. This is a broad source audit, not a certification that all possible vulnerabilities have been excluded.

## Findings

### F1 — High: anyone can read all alerts and push tokens

Evidence: `backend/server.js:584`, `buildAlertSnapshot` at line 373; mobile `www/assets/js/alertsManager.js:61` and `homepage.js:553`.

`GET /api/alerts` has no authentication and serializes every alert, including `deviceToken`, IDs, attraction names, thresholds and timestamps. The homepage supplies a deviceToken query parameter, but the backend ignores it. The mobile alerts page does not even supply that filter. The offline check requested token B's list and received synthetic token A's record.

Impact: anyone who can reach this API can collect installation-associated tokens and preferences, correlate activities, and obtain IDs for F2. A park preference is not proof of a person's actual physical location. A push token alone does not give control of an iPhone or provide Firebase sender credentials.

Fix: authenticate an installation or user; derive ownership from a verified server identity; return only owned records using an explicit response field allowlist that excludes push tokens. Do not treat a caller-supplied push token or query filter as proof of identity. Set private alert responses to `Cache-Control: no-store`.

### F2 — High: anyone can alter/delete others' alerts or impersonate their subscriptions

Evidence: `backend/server.js:535`, `:604`, `:633`.

POST trusts the supplied deviceToken. PATCH and DELETE accept a record ID without an ownership check. UUIDs cannot protect records because F1 lists them. The offline check updated and deleted an alert without any credentials. An attacker with an exposed token can overwrite a real subscription's threshold or create subscriptions on behalf of that installation. Repeatedly overwriting an existing alert also clears triggeredAt, potentially causing repeated legitimate ride notifications when Firebase is enabled.

Fix: require identity and ownership on all CRUD routes, bind device registration to that identity, and protect token replacement. Validate ride IDs against supported rides, not arbitrary names. Include cross-installation denial tests. App attestation can supplement abuse controls but does not replace authorization.

### F3 — Critical: stored attacker HTML reaches the mobile app

Evidence: POST accepts arbitrary `name` at `backend/server.js:537`; `themeparkinfo-mobile/www/assets/js/alertsManager.js:114–119` inserts it into innerHTML. Public renderer has the same unsafe interpolation at `public/assets/js/alertsManager.js:147`. Homepage alert names and multiple upstream ride fields also use HTML interpolation.

An unauthenticated caller can persist HTML as an alert name. Every mobile alerts page fetches the shared list, placing that HTML into the app's trusted page. No application Content Security Policy was found. An event-handler HTML payload is therefore a credible stored-XSS path. The offline check verified acceptance, persistence and unescaped HTML reaching the rendering sink; execution, exfiltration and native plugin invocation on a physical device were not tested.

Impact: hostile script could read/change app localStorage, change the displayed interface, send requests as the app, and potentially use the registered Capacitor plugin capabilities. This does not imply unrestricted access to all phone data or defeat OS permissions/sandboxing.

Fix: render external and user-provided strings with textContent and DOM construction. Validate all interpolated attributes and URLs. Use a vetted sanitizer only where rich HTML is actually required. Add a restrictive CSP as defense in depth, and apply fixes to both public and mobile copies. Clean existing stored records after protecting the routes. Do not assume a normal-looking ride name from an upstream API is safe HTML.

### F4 — Critical advisory: vulnerable Capacitor runtime

The mobile lockfile resolves android/ios/core to 8.3.1. The iOS Swift package separately pins capacitor-swift-pm to 8.3.0. Both native runtime versions fall in the affected ranges of GHSA-rvm3-566m-v7fv (CVE-2026-103922). The advisory describes a trusted-origin bypass through the internal HTTP proxy. It requires activating a link in the WebView; F3 provides a possible attacker-controlled link delivery surface. This runtime exploit was not executed during the audit.

Fix: align Capacitor packages on a verified patched release (the advisory lists 8.4.3 and 8.5.1 in the 8.x series), regenerate/sync native projects, verify the Swift package no longer pins the vulnerable runtime, rebuild and redistribute both apps. Merely changing web assets or disabling CapacitorHttp is insufficient according to the advisory.

Source: https://github.com/advisories/GHSA-rvm3-566m-v7fv

### F5 — High: alert creation allows unbounded resource consumption

Evidence: `backend/server.js:535–582`, persistence at `:98`, repeated full-list processing in cache updates.

No app-level rate limiting, per-owner/global quotas, maximum string lengths, token format checks or maximum wait threshold were found. Arbitrary unique names/tokens create unlimited records; every mutation rewrites the complete JSON file, and every GET renders/sorts all records. Express's default JSON body limit constrains each request, not cumulative stored records. A flood could exhaust memory/disk, increase notification work and make the service unavailable. Hosting-level mitigation is unknown; no flood was run.

Fix: identity-bound quotas, request rate limits, strict schema validation, bounded field lengths/thresholds and supported attraction IDs. Use a database with indexed ownership, transactional writes, retention and monitoring.

### F6 — Medium: persistence failures and concurrent writes threaten availability/integrity

The backend uses Express 4. Route handlers await direct `fs.writeFile` calls without catch/next handling. Rejected async handlers are not automatically forwarded by Express 4; disk failures may produce unhandled rejection/process failure or hanging requests depending on the runtime. Multiple concurrent writes to the same file are not serialized and are not atomic; corruption or lost persistence is possible. No deliberate disk failure or concurrency stress test was run.

Fix: async error handling, centralized non-sensitive error responses, and transactional storage. An interim file implementation needs serialized writes, temporary-file/rename updates and recovery.

### F7 — Medium: push identifiers leak into logs, URLs and storage without a retention policy

Evidence: `backend/server.js:444` logs full tokens on push errors; both homepage copies put tokens in a GET query; `alertbtn.js:29–39` stores tokens in localStorage. Server alert records retain tokens/timestamps until deletion or a failed send removes an invalid token. No time-based alert expiry, owner-wide deletion or token lifecycle cleanup was found. The frontend returns an existing stored token before re-registering, making refresh/revocation handling incomplete.

Request URLs may be retained by hosting/proxy logs. localStorage is readable by same-origin injected script, making F3 particularly relevant. There is no need to expose tokens in read responses or URLs. Push-provider identifiers are not the same as a hardware serial number.

Fix: redact logs, remove identifiers from URLs, use verified identity for retrieval, support token rotation/revocation, set reasonable retention, provide delete-all functionality, and document collection/sharing. Consider protected native storage for authentication credentials; storage changes alone do not fix active XSS.

### F8 — Medium defense gap: permissive CORS and no application CSP/security headers

`app.use(cors())` permits any website origin to read responses. This increases browser-based exposure of the unauthenticated API. Restricting CORS alone cannot stop direct API callers. No CSP configuration or security-header middleware was found in the app; a hosting proxy could add headers, but this was not verified.

Fix: allow the actual website and Capacitor origins; add a CSP compatible with local scripts, required APIs and map frames; evaluate HSTS at the HTTPS edge, anti-framing and Referrer-Policy. Authentication/authorization and safe rendering remain the primary fixes.

### F9 — Low/Medium: Android backup and broad FileProvider scope

`AndroidManifest.xml` enables allowBackup without explicit backup/data extraction exclusions. The FileProvider exposes the entire configured external/cache roots in `res/xml/file_paths.xml`. It is correctly non-exported and requires URI grants, and no current code path granting an attacker a broad URI was found. These settings are hardening concerns, not demonstrated arbitrary-file access.

Fix: decide what app identifiers/preferences should survive backup/device transfer; explicitly exclude sensitive data and narrow provider roots to needed subdirectories, or remove unused sharing support. Verify the final merged manifest and backup behavior on target Android versions.

### F10 — Dependency alerts beyond Capacitor

Backend npm audit: 21 affected package entries (3 critical, 6 high, 10 moderate, 2 low). Mobile: 5 entries (3 critical, 2 high). Counts include transitive packages and propagated dependency effects; they are not 26 independently demonstrated exploitable app vulnerabilities.

Backend critical entries: protobufjs, proxy-addr and websocket-driver. Reachability needs assessment: this app does not expose a gRPC/WebSocket server, and no trust-proxy/IP authorization configuration was found. Mobile tar, brace-expansion and xmldom are generally build/CLI tooling concerns in this dependency tree; a native app does not run the Node CLI merely because it appears under production npm dependencies. Full details and advisory URLs are in the saved JSON files. npm reports fixes available, but no updates were applied or tested.

Fix: update compatible dependencies and regenerate lockfiles; review remaining advisories by reachable function, rebuild both platforms and rerun checks. Do not blindly apply force upgrades.

## Device data and sharing map

| Destination/storage | Observed data or behavior | Meaning |
| --- | --- | --- |
| App localStorage | Push token, ride favorites, local alert settings, cached schedules | Installation/preferences data; readable by same-origin script |
| ThemeParkInfo API on Render | Push token plus park, ride name and threshold for native alert creation; server adds IDs/timestamps | Linkable preferences stored in JSON; no verified identity separation |
| Firebase/Google on Android | firebase-messaging SDK; server sends token and notification title/body/data through Firebase Admin | Push infrastructure processes installation identifiers and notification data |
| Apple push on iOS | AppDelegate receives an APNs device token | Current iOS code forwards that token through the same frontend flow; no Firebase Messaging iOS integration found, so end-to-end iOS delivery via this FCM backend needs correction/testing |
| api.themeparks.wiki | Direct schedule requests identifying the requested park | Provider can observe network metadata; no GPS coordinates sent by reviewed code |
| www.google.com | Embedded map search using ride/park name when ride details are opened | Shares requested attraction and ordinary request metadata; embedded service may use cookies depending on platform/settings |
| cdnjs.cloudflare.com | External Font Awesome stylesheet/fonts | Direct third-party requests; stylesheet links have no integrity attribute |
| Server upstream park APIs | URLs taken from environment, fetched server-side | No client-controlled fetch URL found; deployed URLs unknown |

Firebase explicitly documents installation IDs for Cloud Messaging: https://firebase.google.com/support/privacy

No app code requesting GPS location, contacts, photos, microphone or camera was found in the reviewed source/native declarations. No advertising or analytics SDK was identified in reviewed declared dependencies. This does not exclude automatic SDK/network metadata, transitive native behavior or a different deployed build. Android FCM can initialize independently of the notification permission prompt; that prompt should not be treated as blanket consent for all collection.

No obvious private keys/service-account secret patterns were found in the searched current source files. Firebase Admin credentials are read from an environment variable. `.env` and general signing-key patterns are not excluded by the root .gitignore, so add appropriate secret-file exclusions and repository secret scanning. The tracked `backend/data/alerts.json` is currently empty; it should not become a mechanism for committing real users' tokens. A current pattern scan cannot establish that no secrets exist in past commits or cloud settings.

Positive controls: configured backend URL is HTTPS; no broad ATS exception or explicit Android cleartext override found; Firebase messaging service/FileProvider are non-exported; notification PendingIntent is immutable; notification navigation selects a fixed alerts path; static hosting is rooted at public rather than the backend directory. No SQL database, shell execution of user input, or caller-selected upstream URL was found in reviewed backend code.

## Remediation and acceptance checks

1. Before sharing builds: restrict/disable exposed alert functionality at the server until F1–F3 are fixed; patch/rebuild Capacitor. Web UI hiding does not protect the endpoint.
2. Add authenticated per-installation ownership. Test two identities: each can access only its own alerts; missing/forged identity and another identity's record ID must be denied. Never return raw push tokens.
3. Replace unsafe HTML interpolation throughout website/mobile, then test harmless injection markers in a real Android/iOS WebView and verify they render as text. Add CSP.
4. Add bounded validation, quotas/rate limits, robust persistence and error handling. Test write failures and ownership under concurrency in a disposable environment.
5. Update dependencies, verify native resolved versions and release configurations, test push token rotation and deletion, and review privacy disclosures against actual data flows.
6. Separately verify Render/Firebase/Codemagic/App Store Connect access, least-privilege API keys, MFA, logs/backups/retention, HTTPS/security headers and deployed API behavior. Check release binaries' permissions, WebView debugging and SDK manifests. No guarantee of absence of compromise is possible without operational evidence.

Only audit artifacts were added. No application fixes or deployment changes were made.
