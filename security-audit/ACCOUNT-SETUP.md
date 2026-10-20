# Account sign-in setup

## Test locally without a real login

From `backend`, run `npm run start:local`. Open **http://localhost:3001/pages/login.html** and choose **Continue as test user**. This starts Firebase's Authentication Emulator at `127.0.0.1:9099`, with the separate `demo-adventure-scout` project. Google passwords and real email addresses are unnecessary. This process is currently running for review.

Port 3001 avoids interrupting an existing server on 3000. Stop the local session with Ctrl+C. Emulator accounts are disposable; restarting it may require signing in as a test user again. Test app data uses `backend/data/local-auth-test`, separate from normal alert storage. The emulator and test backend bind to loopback. Production/Render reject emulator configuration at startup, and production rejects anonymous identities. There is no production guest-access flag or shared bypass password.

The emulator also supports testing email sign-up/verification/reset with synthetic addresses. Its verification links appear in the emulator terminal, rather than a real inbox. Do not use real passwords in development.

## Real Google and email sign-in

1. Firebase Authentication: enable Google and Email/Password (already reported enabled).
2. Under Authentication → Settings → Authorized domains, add `themeparkinfo-api.onrender.com`, your actual website domain if different, and `localhost` for local production-project testing.
3. Under Project settings → Your apps → Android (`com.juanm.themeparkinfo`), register the debug signing certificate's SHA-1 and SHA-256. Register release/Play App Signing fingerprints before production distribution.
4. **Updated Android configuration received and installed.** `themeparkinfo-mobile/android/app/google-services.json` now contains one matching Android OAuth client and one Web OAuth client for `com.juanm.themeparkinfo` in project `themeparkinfo-ba1e8`. The Android OAuth certificate matches this machine's debug signing certificate. The Web OAuth client supplies `default_web_client_id` during the Google Services build step. This file remains gitignored. Real Google sign-in still needs an installed build and the deployed account backend to be tested end to end. Register release/Play signing fingerprints separately before distribution. Never put a service-account private key in this file or in public assets.

   Current debug certificate SHA-1: `E9:3B:5B:73:91:63:5E:C6:9E:DD:35:A3:D7:64:41:69:50:BD:5C:68`.

   SHA-256: `E8:78:FF:20:49:7C:09:00:6D:7B:32:1F:35:AA:09:3E:BF:44:1A:60:AF:FF:B1:54:FC:FA:23:7C:C1:14:A1:71`.
5. The public Firebase web configuration is in `public/assets/firebase-config.json` (copied to `www`). It now uses the registered Adventure Scout Web app configuration supplied from Firebase Project settings, including its Browser API key and Web app ID. The key is public client configuration, not an administrative secret. Analytics is not imported or initialized; `measurementId` alone does not enable it. Review API restrictions for each platform separately; the current `no-referrer` policy must be accounted for before adding website-referrer restrictions.
6. Render must retain `FIREBASE_SERVICE_ACCOUNT_JSON` for this same project. It must not have `FIREBASE_AUTH_EMULATOR_HOST`. Deploy the backend and web changes together, then install a newly synced Android build. Existing installed versions without account headers will receive 401 responses after enforcement is deployed; coordinate the rollout with the app update.

## What is implemented

- Google sign-in uses Firebase Web Authentication in browsers and the Capacitor Firebase Authentication native Android plugin on Android. Email/password supports sign-up, sign-in, verification/resend, and password reset. Password users must verify their email before production API access.
- The client waits for a verified session and selects the correct local profile before loading page scripts. Backend API access independently validates Firebase ID tokens and checks revocation; hiding the login screen is not an authorization check.
- Identity tokens are attached only to the fixed backend origin's `/api/` requests. Existing device credentials remain a separate proof of alert ownership. Private alerts are bound to the authenticated account, and pending push verification proofs cannot cross accounts.
- Android credentials are separately encrypted per account. The first account safely migrates the previous unscoped credential. Existing backup exclusions cover preferences. Capacitor logging is disabled to keep bridge calls containing passwords/credentials out of debug logs.
- Favorites and browser alerts are separated by account on the installation. These are **not yet cross-device cloud sync**. Push alerts remain device-specific. Sign-out detaches Android push before clearing the session, retaining saved alerts for re-verification on a later login. Already submitted push messages cannot be recalled.
- Static assets and the aggregate public `/park-feed/:park` feed remain public. All `/api/` endpoints except `/api/auth/config` require authentication; private account/device data is never exposed through the public feed. This preserves keyless local park-data testing after deployment. No Firebase admin token is forwarded to the feed.
- iOS native Google sign-in and iOS distribution have not been configured or tested in this change.

## Rebuild and validation

After changing `themeparkinfo-mobile/auth-client.js`, run `npm run build:auth` from that folder. The self-hosted bundle includes only the Firebase app/auth imports used by this client. Keep shared public/www assets in sync, then run `npx cap sync android` and the Android build.

Tests cover production/emulator access policy, email verification, account binding, push ownership, migration failures, local UI notifications, and sign-in UI states. Local browser testing confirmed emulator entry into the live dashboard and sign-out back to login. Real Google account authorization and physical-device native authentication still require the Firebase configuration above and a deployed backend.

Production npm audits for backend and mobile returned zero advisories after overriding Firebase's transitive gRPC dependency to a patched version. The development-only Firebase CLI dependency tree has advisories (including braces/chokidar and telemetry dependencies); it is not part of the production backend install when dev dependencies are omitted. Do not expose emulator services to a network. This is not a native dependency vulnerability certification.
