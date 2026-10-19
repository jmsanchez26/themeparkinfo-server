# Additional API abuse protections

This follow-up changes backend behavior only. Deploy the server to activate it; mobile rebuilds are not required for these changes.

## Storage writes

Delete-all checks whether this owner has any devices/alerts inside the serialized transaction queue, before cloning state. Unknown owners receive an idempotent success without cloning or writing the alert store. This ordering also respects a registration queued before the deletion. Unauthorized alert creation and attempts to edit/delete unowned record IDs are rejected before opening transactions. Existing ownership checks are repeated inside mutations where needed.

AlertStore remembers the last committed serialization and skips disk writes when the resulting data is unchanged. The in-memory state and serialization are updated only after a successful atomic file replacement; write failures still roll back. Hourly retention cleanup and repeated delete-all calls therefore avoid unnecessary disk activity.

## Request and verification limits

- Public park data: 180 reads per minute per client IP, shared across park paths. Excess requests receive HTTP 429, Retry-After and a non-cacheable JSON error.
- Private API: the existing 120 requests per minute per IP remains. Mutations additionally have a separate 30-per-minute limit per private owner credential. Reads do not consume this mutation budget.
- Verification validates token syntax and push-service availability before counting a device challenge. Malformed tokens cannot consume another installation's verification allowance.
- New/unverified identities have 5 challenge attempts per IP per 15 minutes. Every owner credential also has 3 attempts per 15 minutes. Tokens have a 3-per-15-minute budget across unrelated unverified credentials, so changing credentials/IPs cannot bypass the same token's limit.
- Registered owners use a separate owner-bound token budget and reserved verification capacity. The old app-wide 200-per-hour challenge quota is removed. An anonymous flood no longer exhausts that shared hourly counter.
- Pending proofs expire after two minutes. Anonymous pending challenges are capped at 150 and registered-owner challenges at 50; concurrent Firebase sends are separately capped at 8 and 4. A busy anonymous queue/send slot does not consume the registered-owner reservation.

Capacity parameters are server-side constants; callers cannot change them. The token proof, one-use verification and per-owner alert isolation are unchanged. This is application-level protection, not a guarantee against distributed denial of service: edge protection and monitoring are still needed, particularly for new registrations. Someone who controls real registered devices can still consume their own budgets. Rate-limit/pending state is in memory and resets on process restart, consistent with this application's current single-process deployment.

## Deployment and remaining work

Keep one backend instance while using the JSON store. Configure TRUST_PROXY_HOPS only after verifying the hosting provider's trusted proxy chain; otherwise IP-based limits may group unrelated users or become vulnerable to spoofed forwarding headers. Tests use an explicit trusted proxy only in local fixtures; production defaults to trusting none.

Render persistent storage, account permissions, edge limits, signing keys and installed device behavior have not been changed or inspected by this patch. The mobile credential still uses app localStorage; migrating it to platform secure storage remains a separate task. No production load test or real push notification was used to validate these changes.
