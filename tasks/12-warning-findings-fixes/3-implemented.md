# Task 12: Implemented

## Result

Implemented all seven Warning fixes from `tasks/10-whole-project-review/4-code-review.md`. Linkwarden HTTPS now verifies certificate chains and hostnames, bulk Wake reports real outcomes, local `.env` startup works, JSON parsing is byte-correct, collection selections use bounded incremental eviction, dialogs have local accessible errors, and server/browser behavior has executable coverage.

The project version is now `0.8.0`.

## Changes

### Server composition and API coverage

- Extracted the HTTP application into `src/app.js` as `createDashboardServer()` with injected store, Linkwarden client, Wake executor, clock, and collection-selection storage.
- Reduced `src/server.js` to production dependency construction, listening, and graceful shutdown.
- Kept Host, Origin, and private-network request enforcement at the application boundary.
- Corrected SQLite unique-constraint classification so duplicate device MAC addresses return HTTP 409 under the current Node SQLite error shape.
- Added direct integration coverage for device create/list/update/delete, field validation, duplicate MAC addresses, Wake dispatch, unknown devices, cooldown rejection, dispatch failure, and oversized bodies without sending UDP packets.

### Secure Linkwarden TLS

- Removed the `rejectUnauthorized: false` transport override.
- Added optional `LINKWARDEN_CA_FILE` configuration and startup validation for missing, unreadable, or empty bundles.
- Scoped the configured CA to Linkwarden requests and combined it with Node's default roots; hostname verification remains enabled.
- Preserved scoped CA trust across same-origin Linkwarden redirects.
- Added tests proving default rejection of an untrusted certificate, successful explicit private-CA trust, and rejection of a trusted certificate with a mismatched hostname.

### Environment startup

- Added a dependency-free `.env` parser/loader in `src/env.js` and a startup wrapper in `src/start.js`.
- Updated `start`, `start:lan`, and `dev` to load the root `.env` before importing application configuration.
- Existing process environment values take precedence, and a missing `.env` remains valid.
- Updated `.env.example` with a functional local key-file path and optional private-CA path.
- Added parser, precedence, missing-file, quoted-value, and production-startup tests.

### Request parsing and collection selections

- Reworked `readJson()` to accumulate Buffer chunks, enforce the 16,384-byte limit on bytes, and decode UTF-8 once after the complete request.
- Added split-multibyte, exact-boundary, multibyte-overflow, and HTTP oversized-body tests.
- Added `src/collection-selections.js` with configurable capacity, clock, and token generation.
- Expired tokens are pruned and only the oldest entries needed for capacity are evicted; the store never clears every active token during normal issuance.
- Added deterministic tests for expiry, oldest-first eviction, fingerprint isolation, bounded size, recent-token validity, and explicit clearing.

### Browser behavior and accessibility

- Added framework-free browser helpers in `public/app-helpers.js` and executable Node tests for Wake aggregation, pending-button state, selection updates, dialog-local errors, collection presentation, and focus restoration.
- Bulk Wake now uses concurrent requests without swallowing failures and reports full success, partial failure with counts, or total failure.
- Added explicit in-flight state so rerenders and checkbox changes cannot re-enable the bulk button during a batch.
- Device checkbox and collection button changes update controls in place instead of rebuilding their trees.
- Full collection-tree rerenders restore focus by stable tree position when the corresponding control still exists.
- Added `aria-labelledby` to both dialogs and a device-local alert region. Device form failures remain inside the open device dialog; Linkwarden form failures remain inside its dialog.

### Documentation and release configuration

- Documented `.env` precedence, LAN startup safety, private-CA setup, Compose paths, and verification commands.
- Passed `LINKWARDEN_CA_FILE` through Compose while relying on the existing read-only project bind mount for `./certs`.
- Ignored `certs/` to prevent accidental CA bundle commits.
- Added `npm run check` and bumped `package.json` from `0.7.1` to `0.8.0`.

## Verification

- `npm test`: passed, 44 tests.
- `npm run check`: passed.
- `git diff --check`: passed during final verification.
- OpenSSL-backed TLS tests: passed for untrusted rejection, configured private-CA trust, and hostname mismatch rejection.
- Production startup through a temporary `.env`: passed in the automated suite.
- Missing `.env`, parser precedence, quoted values, and configuration propagation: passed in the automated suite.
- Device CRUD, validation, Wake dispatch/cooldown/failure, and oversized HTTP input: passed through the injected integration server.
- Bulk Wake complete/partial/total outcomes, pending state, selection updates, and collection focus restoration: passed through executable browser-helper tests.
- Dialog naming and local alert placement: passed through static markup assertions.
- Docker Compose validation: not run because the `docker` executable is unavailable in this container.
- Manual assistive-technology keyboard testing: not run because this environment has no interactive browser. The focus-preservation and dialog-targeting logic is covered by executable helpers and markup assertions, but should still receive a browser smoke test in deployment.
