# Task 15: Home Assistant Controls Implementation

## Result

Implemented safe Home Assistant on/off controls for enabled `light`, `switch`, `fan`, and `input_boolean` entities associated with device-registry entries. Device cards now show entity state and accessible controls while Home Assistant identifiers, credentials, arbitrary service names, and service data remain server-side.

## Changes

### Home Assistant protocol and normalization

- Expanded each device snapshot to correlate device registry, area registry, display entity registry, and current state commands over the authenticated WebSocket connection.
- Added bounded validation and normalization for entity/state records, deterministic control sorting, safe name fallback, and `on`, `off`, `unavailable`, or `unknown` state mapping.
- Excluded disabled devices, hidden/config/diagnostic entities, unsupported domains, orphan entities, and missing states from actionable controls.
- Added one-shot authenticated `call_service` requests with a fixed domain allowlist and only `turn_on` or `turn_off` actions.
- Kept mutating requests free of automatic retry, cleared snapshot caches after accepted actions, and retained existing timeout, cleanup, TLS, and safe-error behavior.

### Opaque authorization and API

- Added a bounded in-memory Home Assistant control store using cryptographically random, expiring tokens bound to the current saved connection fingerprint.
- Public snapshots now contain only control token, safe name, normalized state, and availability. Device IDs, entity IDs, domains, raw attributes, and fingerprints are removed before serialization.
- Added `POST /api/home-assistant/controls/:controlToken` with strict one-field JSON validation, current-configuration token resolution, unavailable-target rejection, duplicate in-flight suppression, and safe status-specific errors.
- Cleared control tokens after successful reconnect and disconnect while preserving the old configuration and tokens after a failed reconnect.
- Kept action acceptance separate from the browser's subsequent state refresh so a refresh failure cannot misreport an already completed service call.

### Dashboard UI

- Updated the Home Assistant description and device cards with compact entity rows, visible normalized state, and native on/off buttons.
- Added `aria-label`, `aria-pressed`, disabled unavailable states, per-control pending state, and live action/refresh status messages.
- Included control names in device search and protected action/refresh completion with the existing request generations so disconnect/reconnect cannot restore stale state.
- Added responsive control styling consistent with the existing dashboard visual language.

### Tests and documentation

- Added control-token tests for capacity, expiry, fingerprint binding, malformed token rejection, collision retry, and clearing.
- Expanded protocol tests for four-command snapshots, all supported domains, filtering, exact service payloads, invalid targets, action failures, malformed responses, close, and timeout.
- Expanded API tests for identifier non-disclosure, available/unavailable controls, forged and stale tokens, strict bodies, duplicate suppression, safe failures, token invalidation, and unchanged encrypted credentials.
- Updated the secure private-CA WebSocket fixture, browser-helper tests, and static markup checks for the new entity/state and control behavior.
- Documented supported/unsupported controls, opaque targeting, action-versus-state semantics, dedicated non-admin user guidance, and trusted-LAN requirements.
- Updated the project version from `0.9.1` to `0.10.0`.

## Verification

- `npm test`: passed, 61 tests with 0 failures and 0 skips.
- `npm run check`: passed.
- `git diff --check`: passed before this implementation record and rerun during final verification.
- The OpenSSL-backed private-CA `wss://` integration test passed with the expanded entity/state snapshot protocol.
- A real Home Assistant instance was unavailable, so real `list_for_display`, `get_states`, and `call_service` compatibility was not exercised outside deterministic protocol fixtures.
- Docker Compose validation and container control testing were unavailable because the Docker executable is not installed in this environment.
- Interactive browser keyboard and narrow-screen checks were not run in this terminal-only environment; accessibility state and responsive markup/styles are covered structurally and by helper tests.
