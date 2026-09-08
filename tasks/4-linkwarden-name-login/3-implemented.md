# Linkwarden name-based login implementation

## Delivered

- Replaced numeric collection-ID and API-key setup fields with Linkwarden URL, username, access token, and a server-provided collection selector that lists every authenticated collection by name.
- Verified Linkwarden v1 collection discovery uses `GET /api/v1/collections`, a `response` array, and Bearer access-token authorization. Bookmark normalization now supports the documented response envelope.
- Added protected collection-list handling that returns only collection names with short-lived opaque selection tokens. Numeric collection IDs remain only in server memory and SQLite.
- Migrated the singleton configuration record with nullable username and collection-name fields. Existing ID-based rows remain intact and are explicitly marked for re-authentication before bookmark retrieval.
- Renamed the configuration boundary to access-token terminology while retaining AES-256-GCM encrypted-at-rest credentials. Status responses omit token and encrypted material.
- Updated documentation, added collection discovery and legacy-migration coverage, and bumped the application version to `0.4.0`.

## Verification

`npm test` passes with 13 tests. `node --check src/server.js`, `node --check src/linkwarden.js`, `node --check public/app.js`, and `git diff --check` pass.
