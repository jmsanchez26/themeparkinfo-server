# Mobile security review — 2026-10-18

## Android credential storage follow-up

Implemented locally after the review below: Android now stores the alert credential as AES-GCM ciphertext in private SharedPreferences, using a non-exportable Android Keystore AES key. Existing valid localStorage credentials migrate on the first private alert request; plaintext is removed only after successful native persistence. Concurrent requests share initialization. Missing bridge, encryption/decryption, or persistence failures block requests rather than create a plaintext fallback or silently replace an unreadable identity. Successful server-side delete-all clears the encrypted credential and in-memory cache. The Keystore encryption key remains available for the next identity; no previous plaintext credential is persisted by this plugin.

Web and iOS retain their previous storage behavior. The native bridge returns the decrypted credential to JavaScript in memory for authorization; this reduces persistent plaintext exposure but does not prevent a successful script injection from using the app's native bridge or active credential. Existing backup exclusions cover the new private preferences. Hardware-backed key availability depends on the Android device and is not guaranteed by this implementation.

Validation: **51 automated tests passed**, including six migration/failure/concurrency/deletion checks across shared web assets. Android debug/release assembly and release lint passed; no lint findings reference the new plugin or activity registration. Android assets synced and APKs rebuilt. Native Keystore behavior and upgrade migration on a physical device remain untested because no device is connected. This follow-up accompanies the Android credential-storage change.

Reviewed commit `8ef8754`, pushed to origin/main before testing. This is a bounded source/configuration review and automated test run, not a full device penetration test.

## Results

- Backend and shared client regression suite: **45 passed, 0 failed**. Includes cross-owner isolation, delivery proof replay/ownership, malicious stored HTML, validation, rate limits, and simulated Android/iOS UI behavior.
- Mobile production npm audit: **0 known advisories**. This checks npm dependencies, not every native Maven/Swift dependency or unpublished vulnerability.
- Capacitor sync completed for Android and iOS.
- Android `assembleDebug assembleRelease lintRelease` completed successfully. Release APK is unsigned. App lint contains warnings, including dependency freshness, manifest ordering, unused resources, and a callback warning for the unused custom messaging service. Capacitor dependency lint also uses an existing baseline; successful lint does not mean every dependency is warning-free.
- Inspected merged release manifest: backups disabled; file provider and messaging services are non-exported. Exported Firebase/profile receivers require platform permissions. No camera, microphone, contacts, or location permission declared. Release manifest does not enable debugging; Capacitor configuration has no remote server, navigation wildcard, mixed-content, or WebView-debugging override.
- Release APK filename scan: no .env, private key/signing key, service-account JSON, or secure-alerts.json entries matched. This is a limited packaging check, not proof of absence of all secrets. Packaged alertSecurity.js exactly matches current mobile source.
- iOS source: no broad App Transport Security exceptions or camera/microphone/location usage declarations. Release Swift settings do not enable DEBUG. No native archive was built or inspected.

## Remaining risks and release work

1. **Alert credential storage:** the per-install bearer credential remains in WebView localStorage (`www/assets/js/alertSecurity.js`). A successful script injection could read it and impersonate that installation for alerts. Existing sanitizer/CSP tests pass, but this remains a defense-in-depth gap. Native secure storage should be evaluated alongside restrictions on bridge access; secure storage alone does not stop malicious JavaScript using an authorized bridge.
2. **Native dependency coverage:** npm audit does not establish that all Android/iOS native dependencies are free of advisories. Lint reports newer native dependency versions; version freshness alone is not evidence of a vulnerability.
3. **Release signing and push:** Android release output is unsigned. iOS source entitlement specifies development APNs; distribution signing/provisioning and notification behavior must be checked in a real archive. Existing iOS background push integration remains incomplete; this review does not certify delivery.
4. **External requests:** CDN assets, park schedule services, and map embeds create third-party network requests. No device permission is needed for a server to receive ordinary request metadata such as an IP address. A packet capture/privacy review was not performed.

## Limits

No Android device/emulator was connected in adb. No native runtime exploitation, traffic interception, backup extraction, deep-link abuse testing, or signed release installation was performed. iOS compilation, entitlements validation, Keychain/backup behavior, and device testing require macOS build infrastructure and an iPhone/simulator. Render deployment/configuration was not verified by this local run.

