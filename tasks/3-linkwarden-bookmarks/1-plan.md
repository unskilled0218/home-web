# Linkwarden bookmarks integration plan

## Goal

Show bookmarks from one configured Linkwarden collection in the LAN Wake dashboard, using the Linkwarden server URL, collection ID, and API key without exposing the key to browsers.

## Scope and decisions

- Add `LINKWARDEN_URL`, `LINKWARDEN_COLLECTION_ID`, and `LINKWARDEN_API_KEY` configuration. Keep the API key only in the server process and do not return it in API responses, logs, errors, static assets, or the client bundle.
- Treat Linkwarden as an optional read-only integration. The Wake-on-LAN dashboard must continue to load and work when it is unconfigured or Linkwarden is unavailable.
- Fetch the configured collection only from the server. Provide a local read-only endpoint such as `GET /api/bookmarks`; the browser never contacts Linkwarden directly.
- During implementation, verify the installed Linkwarden version's documented collection/bookmark endpoint, authorization header, response pagination, and collection-access behavior before fixing the request shape. Request only the configured collection and do not add bookmark editing, deletion, or account-management features.
- Render a compact, accessible Bookmarks section in the existing dashboard. Show a title, safe external link, and available description/tags; use clear empty, loading, unavailable, and refresh states without disrupting device management.
- Validate configuration at startup: require an absolute `http` or `https` Linkwarden URL, a valid positive collection ID, and a non-empty key whenever the integration is enabled. Normalize the base URL and reject malformed values with actionable, non-sensitive errors.
- Make outbound requests bounded and predictable: use a timeout/abort signal, a response-size limit, conservative server-side cache with explicit refresh behavior, and one in-flight refresh per process. On failure, preserve a recent cached result when available and otherwise return a generic service-unavailable result.
- Normalize the remote payload into a small local view model (`id`, `name`, `url`, optional `description`, optional `tags`, and optional `favicon`). Validate URLs before returning them, omit malformed entries, escape via DOM text APIs in the client, and use `target="_blank" rel="noopener noreferrer"` for outbound links.
- Preserve the current LAN-only request policy and same-origin protections for the local endpoint. Do not make the Linkwarden URL user-controlled through a request, and never proxy arbitrary paths or URLs.

## Implementation sequence

1. Add the Linkwarden settings to `.env.example`, `src/config.js`, and README setup guidance, including how to create a least-privilege/read-only API key and locate the collection ID. Document that the credentials belong only in the server environment.
2. Create a focused Linkwarden client module that builds the verified collection-bookmark request from fixed configuration, applies authorization, pagination handling, timeout, size limits, response normalization, and cache/fallback behavior. Keep network access injectable so it can be tested without a real Linkwarden service.
3. Add `GET /api/bookmarks` to `src/server.js`. Return a stable response that distinguishes disabled, empty, available/cached, and unavailable states while keeping remote diagnostic detail out of the response and audit output.
4. Extend `public/index.html`, `public/app.js`, and `public/styles.css` with the accessible Bookmarks section, a refresh control, and non-blocking status handling. Retain all current search, selection, device CRUD, and wake controls unchanged.
5. Add automated tests for configuration validation, request construction and authorization, pagination/normalization, timeout and stale-cache behavior, malicious/malformed remote data rejection, disabled mode, and the local endpoint's LAN/origin protections. Run the existing Wake-on-LAN tests as regression coverage.
6. Update deployment and troubleshooting documentation with the required environment variables, Linkwarden reachability/TLS guidance, cache behavior, failure states, and credential rotation procedure.

## Acceptance criteria

- With valid configuration, the dashboard displays only bookmarks from the selected Linkwarden collection and opening one safely navigates to its saved URL.
- The Linkwarden API key is never sent to or discoverable by the browser, and the server never acts as an arbitrary outbound proxy.
- When Linkwarden is disabled, slow, unavailable, or returns malformed data, device management and Wake-on-LAN continue to work and the bookmark section gives a clear, non-sensitive status.
- Remote data and links are validated before rendering; external links do not give the opened page access to the dashboard window.
- Automated tests cover normal retrieval, credentials/configuration validation, cache/error behavior, response sanitization, and preservation of the existing local-network boundary.
