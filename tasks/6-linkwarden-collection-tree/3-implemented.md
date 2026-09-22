# Linkwarden one-step connection and collection tree implementation

## Delivered

- Replaced Test connection, List collections, collection selection, and Save settings with a single Connect action using only URL, username, and access token.
- Migrated the singleton Linkwarden database record from one selected collection to credentials-only persistence while preserving existing URL, username, encrypted token fields, and timestamps.
- Made Connect atomic: encryption-key validation and remote collection access complete before encrypted credentials replace a saved working connection. Blank-token reconnects retain the existing encrypted token.
- Normalized Linkwarden collection hierarchy metadata and built deterministic nested trees with safe handling for malformed entries, duplicate IDs, missing parents, and cycles.
- Added short-lived opaque collection tokens so the browser can navigate every collection without receiving Linkwarden numeric collection IDs or credentials.
- Added authenticated collection-tree reload after page or server restart and token-scoped bookmark loading for the selected tree node.
- Moved Disconnect and Refresh into the main bookmarks section and added responsive, keyboard-accessible nested collection controls with selected states and empty/error messaging.
- Isolated bookmark caches, stale fallback, and in-flight requests by collection, and invalidated obsolete work on reconnect or disconnect to prevent cross-account data reuse and browser request races.
- Preserved response-size, timeout, pagination-origin, cache, stale-result, and Wake-on-LAN behavior.
- Preserved the requested Linkwarden-only self-signed HTTPS transport without changing global Node TLS settings, and restored bounded same-origin redirect handling without forwarding bearer credentials across origins.
- Updated operator documentation and bumped the application version from `0.4.1` to `0.6.0` for the combined self-signed Linkwarden and collection-tree feature release.

## Verification

- `npm test` passes with 20 tests.
- Syntax checks pass for all source, browser, and test JavaScript files.
- `git diff --check` passes.
- End-to-end tests start a child dashboard and self-signed local Linkwarden service to verify atomic Connect, safe tree payloads, bookmark selection, failed-connect preservation, blank-token reuse, server-restart recovery, invalid encryption-key handling, empty collection accounts, token invalidation, Disconnect, and health availability.
- Unit coverage verifies credential migration, encrypted-token preservation, hierarchy normalization, cycle/orphan handling, deterministic ordering, per-collection stale caches, obsolete-request cache invalidation, response limits, timeout handling, pagination-origin enforcement, and same-origin HTTPS redirects.
- A live probe to `https://bookmarks.lan` confirms the scoped transport accepts its self-signed TLS connection and reaches Linkwarden authentication without setting `NODE_TLS_REJECT_UNAUTHORIZED=0`.
