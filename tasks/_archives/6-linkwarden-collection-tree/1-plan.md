# Linkwarden one-step connection and collection tree plan

## Goal

Replace the multi-step Linkwarden setup flow with one form containing only Linkwarden URL, username, access token, and a Connect button. After a successful connection, persist the credentials securely and show every available Linkwarden collection as a navigable tree in the bookmarks section.

## Current-state constraints

- The current dialog requires Test connection, List collections, one collection selection, and Save settings. The server uses short-lived connection and selection tokens to enforce that sequence.
- SQLite stores exactly one non-null collection ID and name with the encrypted access token, and bookmark loading always targets that saved collection.
- The collection client currently discards hierarchy metadata and returns only numeric ID and name. The browser never receives numeric collection IDs.
- Existing uncommitted work on `4-linkwarden-name-login` intentionally allows self-signed certificates only for Linkwarden requests, updates its documentation and version, and adds TLS coverage. Preserve and integrate those changes rather than reverting or duplicating them.

## Product decisions

- Connect is the only credential-form action. It validates the URL, username, token, encryption key, and remote Linkwarden access in one request; credentials are saved only after the remote collection request succeeds.
- A blank access-token field may retain the existing encrypted token when reconnecting. A first connection still requires a token.
- Remove collection selection from setup. Connection state depends on saved credentials, not a chosen collection.
- Render the collection hierarchy in the main Linkwarden bookmarks section after connection. Selecting a tree node loads that collection's bookmarks; no collection choice is persisted as configuration.
- Keep Disconnect available outside the credential form, next to the connected Linkwarden/tree controls, so the form itself contains only the three requested fields and Connect.
- Never return the access token, encrypted token fields, or remote numeric collection IDs to the browser. Build hierarchy on the server and issue short-lived opaque collection tokens for bookmark requests.
- Treat missing parents, duplicate IDs, and cyclic parent relationships defensively by promoting affected nodes to the root once. Sort siblings deterministically by name and then remote ID on the server.
- Preserve the current cache, stale fallback, timeout, response-size limit, pagination-origin checks, self-signed Linkwarden transport, and Wake-on-LAN independence.

## Implementation sequence

1. Confirm the deployed Linkwarden collection response's hierarchy fields using a sanitized fixture or documented response shape. Extend collection normalization to retain only validated internal `id`, `name`, and nullable `parentId`, accepting the actual response envelope without forwarding raw remote objects.
2. Add a server-side tree builder that links normalized collections by parent ID, handles roots/orphans/cycles/duplicates deterministically, and converts each node to `{ name, collectionToken, children }`. Keep numeric IDs and credential fingerprints only in the existing bounded, expiring server-side token map.
3. Replace the current `linkwarden_config` single-collection schema with a credentials-only singleton schema. Migrate existing rows transactionally while preserving base URL, username, encrypted token, and timestamps; discard the obsolete selected collection fields only after copying recoverable credentials.
4. Update store mapping and Linkwarden status logic so a valid saved URL, username, and decryptable token represent a configured connection. Continue marking legacy rows without usernames for re-authentication and never expose credential material in status responses.
5. Collapse the server API handshake into `PUT /api/linkwarden`: normalize credentials, ensure the encryption key is valid, retrieve all collections once to prove authentication, encrypt and save the token, clear bookmark cache and old opaque tokens, then return the safe Linkwarden status and nested collection tree. A failed remote call or encryption step must leave the previously saved configuration unchanged.
6. Change collection retrieval to an authenticated `GET /api/linkwarden/collections` using saved credentials. Return a newly tokenized nested tree so page reloads and process restarts do not depend on stale in-memory tokens. Remove the connection-verification endpoint/state and credential-bearing collection-list endpoint.
7. Change bookmark loading to require an opaque collection token, resolve it against the current saved connection fingerprint and expiry, and pass the internal collection ID to the existing bookmark client. Keep forced refresh scoped to the active collection and return a concise error for missing, expired, or mismatched tokens.
8. Simplify `public/index.html` so the Linkwarden dialog contains only URL, username, access-token fields, validation messaging, and Connect. Remove Test connection, List collections, collection select, and Save settings controls. Add a collection-tree container and connected-account/Disconnect controls to the main bookmarks section.
9. Refactor `public/app.js` state and events around one Connect action. On startup or successful Connect, load/render the nested collection tree; on node activation, mark it selected and load that collection's bookmarks; on Disconnect, clear credentials, tokens, tree, active collection, bookmarks, and cache-derived UI state.
10. Render the hierarchy with semantic nested lists and buttons, visible selected/focus states, loading/empty/error messages, and keyboard-accessible controls. Update responsive styles so the tree and bookmark cards work on narrow and desktop layouts without restoring a flat selector.
11. Update README instructions to describe URL/username/token plus Connect, automatic collection-tree display, per-node bookmark loading, token retention on reconnect, Disconnect placement, and the scoped self-signed-certificate behavior.
12. Update the project version according to the existing convention and record implementation and verification results in `3-implemented.md`.

## Automated coverage

- Add collection normalization/tree tests for multiple roots, nested children, deterministic sibling order, malformed entries, duplicate IDs, missing parents, and cycles.
- Add store migration tests proving an existing selected-collection row retains URL, username, and encrypted access token while the new schema no longer requires a collection.
- Add API-level tests for successful atomic Connect, failed Connect preserving old configuration, blank-token reuse, invalid encryption keys, collection-tree reload, opaque-token expiry/mismatch, bookmark loading by node token, and Disconnect cleanup.
- Add browser-facing tests where practical for the reduced form, nested tree rendering, node selection, refresh behavior, empty trees, reconnect, and disconnect state. At minimum, extract deterministic tree rendering/state transitions into testable functions if no DOM harness exists.
- Preserve existing encryption, credential validation, bookmark normalization, pagination, response-size, cache/stale fallback, self-signed TLS, and Wake-on-LAN tests.

## Verification

- Run `npm test` and syntax checks for every changed JavaScript file.
- Run `git diff --check` and verify no access token, encrypted token, remote numeric collection ID, or raw remote response appears in browser-facing payloads or logs.
- Manually connect with only URL, username, and access token; confirm the dialog closes and the full nested collection tree appears immediately.
- Reload the page and restart the server; confirm saved credentials rebuild the tree without re-entering the token.
- Select root and nested collections, refresh bookmarks, and verify each request loads only the selected node while cache entries remain isolated by collection.
- Confirm failed credentials do not replace a working saved connection, Disconnect removes the saved token, and Wake-on-LAN remains functional when Linkwarden is unavailable.
- Confirm `https://bookmarks.lan` still connects through the scoped self-signed Linkwarden transport without setting `NODE_TLS_REJECT_UNAUTHORIZED=0` globally.

## Acceptance criteria

- The settings dialog shows only Linkwarden URL, username, access token, and Connect.
- One successful Connect securely saves credentials and immediately displays every available collection as a hierarchy.
- The collection tree survives page reloads by being fetched from saved credentials, and selecting any node loads its bookmarks.
- Browser APIs expose only collection names, hierarchy, and opaque tokens; remote numeric IDs and credentials remain server-side.
- Failed connection attempts are non-destructive, empty collection accounts can still connect, and legacy saved credentials migrate without plaintext exposure.
- Disconnect, caching, stale fallback, scoped self-signed TLS support, and Wake-on-LAN continue to work.
