# Task 13: Implemented

## Result

Implemented the optional read-only Home Assistant integration. Users can validate and save an instance URL and long-lived access token, browse normalized device-registry cards grouped by area, search and refresh devices, and disconnect without exposing the token to the browser or plaintext SQLite storage.

The project version is now `0.9.0`.

## Changes

### Home Assistant protocol client

- Added `src/home-assistant.js` using Node 24's built-in WebSocket client, so local and Compose startup remain dependency-free.
- Implemented the Home Assistant `auth_required` / `auth` / `auth_ok` flow and correlated device/area registry commands.
- Added connection timeouts, bounded message and entry counts, strict protocol validation, generic errors, and socket cleanup on every terminal path.
- Normalized URL/token input and reduced registry records to safe display fields with deterministic area/name sorting.
- Added short-lived credential-scoped caching, forced refresh, in-flight deduplication, and cache-generation protection after clearing.

### Encrypted persistence and API

- Added the singleton `home_assistant_config` table and store methods for encrypted access-token upsert/read/delete.
- Reused the existing AES-256-GCM server integration key without changing its persisted environment names.
- Added protected status, device-list, connect/update, and disconnect routes through the injectable application factory.
- Connection updates fetch devices before saving, blank tokens are retained only for an unchanged URL, and failed reconnects preserve working credentials.
- Added `HOME_ASSISTANT_CACHE_SECONDS` to runtime configuration, `.env.example`, and Compose.

### Dashboard experience

- Added a Home Assistant section between Bookmarks and Wake-on-LAN with connected-instance metadata, search, refresh, disconnect, live status, area groups, and responsive read-only cards.
- Added a named settings dialog with local help/error output, password/autocomplete-safe token input, duplicate-submit prevention, and no token refill.
- Added stale-request generation checks so old device responses cannot overwrite newer connect/disconnect state.
- Reused the existing visual language and mobile breakpoints without adding a frontend framework.

### Tests and documentation

- Added protocol tests for authentication, command correlation/failure, malformed responses, premature close, timeout, bounds, cleanup, cache, refresh, and deduplication.
- Added encrypted persistence and atomic API integration tests, including token retention, URL-change protection, safe failures, and disconnect isolation.
- Extended browser-helper, configuration, section-order, dialog-semantics, unique-ID, and credential-field markup coverage.
- Updated README and package metadata for Home Assistant setup, limitations, encryption, backup, TLS, and trusted-LAN guidance.

## Verification

- `npm test`: passed, 53 tests.
- `npm run check`: passed.
- `git diff --check`: passed.
- Real Home Assistant compatibility: not run because no Home Assistant instance or token is available in this environment; the protocol is covered with injected fixtures.
- Docker Compose validation: not run because the `docker` executable is unavailable in this container.
- Manual browser/assistive-technology testing: not available in this non-interactive container; behavior is covered by executable helpers and static accessibility assertions.
