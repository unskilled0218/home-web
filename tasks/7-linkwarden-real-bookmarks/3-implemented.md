# Linkwarden real bookmark response implementation

## Delivered

- Replaced the nonexistent `/api/v1/collections/{id}/bookmarks` request with Linkwarden's supported `/api/v1/search?collectionId={id}` endpoint.
- Added explicit support for the current `{ data: { links, nextCursor } }` response while retaining validated legacy array envelopes.
- Made malformed envelopes fail as upstream errors instead of silently appearing as empty collections.
- Added real Linkwarden URL-record normalization with safe HTTP(S) destinations, positive IDs, bounded descriptions/tags, and URL fallback when a record name is empty.
- Added fixed-origin cursor pagination with strict numeric cursor validation, repeated-cursor detection, duplicate-ID suppression, and a 100-page limit. Remote payloads cannot supply a pagination URL or move bearer credentials to another origin.
- Preserved per-collection caching, stale fallback, response-size limits, timeouts, scoped self-signed TLS, and safe same-origin redirects.
- Updated the browser empty state to distinguish a collection with no valid web links from malformed or unavailable Linkwarden responses.
- Updated Linkwarden documentation and bumped the application version from `0.6.0` to `0.6.1` as a bookmark-loading bug fix.

## Verification

- `npm test` passes with 20 tests.
- Syntax checks pass for all changed JavaScript files.
- `git diff --check` passes.
- Unit tests cover the current search envelope, multi-page cursor requests, Bearer authorization, empty and malformed results, URL-name fallback, unsafe/null URL filtering, strict cursor types, repeated cursors, page limits, per-collection stale caches, and obsolete-request invalidation.
- The child-server integration test serves bookmarks only from `/api/v1/search?collectionId=2` and verifies the resulting real URL card payload through the dashboard API.
- Source and tests contain no calls to `/api/v1/collections/{id}/bookmarks` or deprecated `/api/v1/links` routes.
- An unauthenticated live probe confirmed `https://bookmarks.lan/api/v1/search?collectionId=1` exists and returns HTTP 401 for an invalid token.
- Live bookmark rendering against the user's authenticated `bookmarks.lan` account was not run because its access token and encryption key are not available in this execution environment.
