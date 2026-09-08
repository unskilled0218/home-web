# Linkwarden bookmarks implementation

## Delivered

- Added an optional Linkwarden configuration stored as a singleton SQLite record with AES-256-GCM encrypted API-key material. The required base64-encoded 32-byte encryption secret stays in the server environment.
- Added trusted-LAN, same-origin local endpoints for masked configuration status, connection testing, saving with key preservation, disconnecting, and fetching only the saved collection's bookmarks.
- Added a bounded Linkwarden v1 collection client with Bearer authorization, timeout, response-size limit, same-origin pagination, normalization, a 60-second cache, stale-cache fallback, and a single in-flight refresh.
- Added dashboard settings and connection controls plus an accessible bookmark section. Bookmarks are rendered with DOM text APIs and safe external-link attributes.
- Added encryption, persistence, validation, payload normalization, request authorization, pagination, and stale-cache unit coverage. Updated setup and credential-rotation documentation and bumped the application version to `0.3.0`.

## Verification

`npm test` passes with 12 tests. `node --check src/server.js`, `node --check src/linkwarden.js`, `node --check public/app.js`, and `git diff --check` pass.
