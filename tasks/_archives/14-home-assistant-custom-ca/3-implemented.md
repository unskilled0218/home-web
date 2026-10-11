# Task 14: Home Assistant Private CA Implementation

## Result

Implemented secure private-CA trust for Home Assistant `wss://` connections. The dashboard can now load `NODE_EXTRA_CA_CERTS` before Node initializes TLS, validates the configured PEM bundle at startup, preserves certificate-chain and hostname verification, and returns safe actionable connection guidance.

## Changes

### Startup and configuration

- Replaced the JavaScript `.env` wrapper with Node 24's native `--env-file-if-exists=.env` startup option for `start`, `start:lan`, and `dev`.
- Removed `src/start.js` and `src/env.js`; process-environment values continue to take precedence and a missing `.env` remains valid.
- Added `NODE_EXTRA_CA_CERTS` to the environment template and Compose forwarding. The existing read-only project mount makes the documented `./certs/home-assistant-ca.pem` path available in direct and Compose deployments.
- Added resolved `NODE_EXTRA_CA_CERTS` configuration and startup validation for readable, non-empty PEM bundles containing parseable certificates and no private keys.

### Home Assistant errors

- Added a dedicated safe Home Assistant client error type so protocol, authentication, TLS, timeout, and connectivity messages can reach the browser without exposing arbitrary upstream errors.
- Added certificate trust, hostname/SAN, and validity-period classification when Node exposes a TLS error code.
- Made the generic fallback actionable by pointing operators to URL/network checks and `NODE_EXTRA_CA_CERTS`. Node 24's built-in WebSocket currently masks some live TLS causes behind a generic `ErrorEvent`, so this fallback remains necessary.
- Kept unclassified injected/upstream failures behind the existing generic device-unavailable API response.

### Tests

- Replaced custom env-parser tests with subprocess coverage for Node's native env-file syntax, missing files, process-environment precedence, production configuration, and pre-initialization extra-CA loading.
- Added CA bundle validation tests for missing, unreadable, empty, malformed, private-key-containing, and valid multi-certificate files.
- Added safe TLS error-classification and API propagation tests that assert upstream details and tokens are not disclosed.
- Added an OpenSSL-backed secure WebSocket fixture with a generated private CA and signed server certificate. Child Node processes prove rejection without trust, successful Home Assistant authentication and registry retrieval with `NODE_EXTRA_CA_CERTS`, and rejection of a trusted certificate under a hostname not present in its SAN.

### Documentation and release

- Documented direct and Compose private-CA setup, process-wide trust scope, PEM requirements, restart behavior, SAN/chain/validity troubleshooting, and the contrast with Linkwarden's scoped CA option.
- Updated the project version from `0.9.0` to `0.9.1`.

## Verification

- `npm test`: passed, 56 tests with 0 failures and 0 skips.
- `npm run check`: passed.
- `git diff --check`: passed before the implementation record was added and rerun during final verification.
- The OpenSSL-backed `wss://` integration test passed for untrusted rejection, configured private-CA success, and hostname-mismatch rejection.
- Docker Compose validation was not run because the Docker executable is unavailable in this container.
- A live Home Assistant instance was not available; protocol behavior and TLS trust were verified through the local secure WebSocket fixture.
