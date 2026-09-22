# Linkwarden real bookmark response plan

## Goal

Display real URL bookmarks for the selected Linkwarden collection instead of reporting `No valid bookmarks were found in this collection.` when the collection contains links.

## Confirmed root cause

- The dashboard currently requests `GET /api/v1/collections/{collectionId}/bookmarks`, which is not the current Linkwarden collection-link endpoint.
- Linkwarden's current API and source implement authenticated collection filtering at `GET /api/v1/search?collectionId={collectionId}`.
- The current search response shape is `{ data: { links: [...], nextCursor } }`, while `normalizeBookmarks()` only accepts a top-level array or `response`, `data`, or `bookmarks` when that value is itself an array.
- As a result, a valid current Linkwarden response is silently normalized to an empty array and the browser shows the same message as a genuinely empty collection.
- Linkwarden still exposes deprecated `GET /api/v1/links?collectionId=...`, but deployments may disable deprecated routes. Use the supported search endpoint rather than depending on that fallback.

## Scope and decisions

- Replace the collection bookmark URL with `/api/v1/search?collectionId={id}` and keep Bearer authorization, timeout, response-size limits, scoped self-signed TLS, bounded same-origin redirects, cache isolation, and stale fallback unchanged.
- Parse current search responses from `payload.data.links`. Retain narrowly scoped support for existing array/`response`/`bookmarks` fixtures only where it represents a documented or previously shipped Linkwarden payload, without treating arbitrary objects as empty success.
- Treat an invalid response envelope as an upstream error so operators see `Bookmarks are currently unavailable.` rather than a false empty-collection message.
- Continue exposing only bookmarks with a positive safe numeric ID, non-empty display name, and absolute HTTP(S) URL. Linkwarden note/image/PDF records with a null URL remain excluded from the web-link dashboard.
- If a valid URL record has an empty name, use its normalized URL as the display name because Linkwarden's schema allows an empty default name even though normal link creation usually fills it from the URL or page title.
- Read pagination from `payload.data.nextCursor`. Build the next request from the fixed configured origin and search endpoint with the same collection ID plus an encoded cursor; never follow a cursor-provided URL.
- Reject invalid, repeated, or unsafe cursors and cap pagination to a reasonable page count so malformed remote data cannot create an infinite loop or unbounded aggregate request sequence.
- Preserve the distinction between a valid empty collection and an invalid/malformed Linkwarden response. Update the empty UI copy to refer specifically to valid web links.

## Implementation sequence

1. Refactor bookmark-envelope parsing in `src/linkwarden.js` to explicitly recognize the current `{ data: { links, nextCursor } }` search response and the supported legacy array envelopes.
2. Update bookmark normalization to accept real Linkwarden link fields (`id`, `name`, `url`, `description`, `tags`) while retaining URL scheme checks, length limits, tag limits, and safe omission of archive-only metadata.
3. Change collection bookmark retrieval to start at `/api/v1/search?collectionId={collectionId}` and construct subsequent pages with `collectionId` and `cursor` query parameters on the same endpoint.
4. Validate pagination cursors as non-negative safe integers, track seen cursors, and enforce a finite page limit. A repeated/invalid cursor must fail the refresh without replacing a valid cache entry.
5. Keep cache keys scoped to base URL and collection ID and preserve stale fallback when a current search request fails after a successful cached load.
6. Update the browser's empty-state wording to `No valid web links were found in this collection.` so URL filtering is clear without masking malformed upstream responses.
7. Update README documentation to state that selected collections are loaded through Linkwarden's current search API and only HTTP(S) URL records are rendered.
8. Update the project version according to the existing release convention and record changes and verification in `3-implemented.md`.

## Automated coverage

- Replace synthetic `/collections/{id}/bookmarks` fixtures with exact current search fixtures containing `data.links` and `data.nextCursor`.
- Assert the first request is `/api/v1/search?collectionId={id}` with the Bearer token and the next request retains the collection filter while adding the cursor.
- Cover real URL records with title, description, object tags, and null/empty optional fields.
- Cover URL-name fallback when `name` is empty and exclusion of null URLs, unsafe schemes, invalid IDs, and non-link records.
- Cover valid empty `data.links`, malformed envelopes, malformed `links`, invalid cursors, repeated cursors, page-limit enforcement, and cross-origin safety remaining intact.
- Update the child-server integration test to expose only the real Linkwarden search endpoint so an obsolete endpoint cannot pass accidentally.
- Preserve collection-tree, encrypted credential, self-signed TLS, redirect, per-collection cache, stale fallback, reconnect, restart, Disconnect, and Wake-on-LAN regression tests.

## Verification

- Run `npm test` and syntax checks for every changed JavaScript file.
- Run `git diff --check`.
- Confirm test request logs contain `/api/v1/search?collectionId=...` and never `/api/v1/collections/.../bookmarks` or the deprecated `/api/v1/links` endpoint.
- Connect to `https://bookmarks.lan`, select a collection known to contain normal URL links, and verify names and real destinations render as bookmark cards.
- Verify a genuinely empty collection shows the web-link empty state, while malformed or unavailable Linkwarden responses show the availability error and retain any matching stale cache.
- Verify pagination loads more than one page without duplicates or loops and never sends the bearer token outside the configured Linkwarden origin.

## Acceptance criteria

- Selecting a Linkwarden collection containing URL links displays those links with their real HTTP(S) destinations.
- The dashboard uses Linkwarden's supported search endpoint and current `data.links`/`nextCursor` response contract.
- Empty collections and malformed responses no longer produce the same result.
- Pagination remains bounded and same-origin, and stale per-collection cache behavior remains intact.
- Collection-tree navigation, encrypted credentials, scoped self-signed TLS behavior, and Wake-on-LAN continue to work.
