# Linkwarden bookmarks integration plan

## Goal

Allow a trusted local dashboard operator to configure one Linkwarden connection from the website, then show bookmarks from its selected collection without exposing the API key to browsers.

## Scope and decisions

- Add a website-based Linkwarden setup screen where the operator can enter the server URL, collection ID, and API key, test the connection, save changes, replace the key, or disconnect the integration. The setup form may be reached only through the existing trusted-LAN dashboard boundary; this application has no user accounts, so all LAN users who can manage devices are trusted to manage this integration too.
- Persist the URL, collection ID, and encrypted API key in the local database. Protect encryption with a separate required server-environment secret (for example, `LINKWARDEN_CONFIG_ENCRYPTION_KEY`) that is never stored in the database or sent to the browser. Do not return the API key in API responses, logs, errors, static assets, or the client bundle; after saving, show only a configured/key-present status.
- Retain environment variables only for the database-encryption secret and optional deployment bootstrap or migration support, rather than making the URL, collection ID, and API key normal runtime configuration. Document that losing the encryption secret makes saved Linkwarden credentials unrecoverable and that rotating it requires a deliberate re-encryption flow.
- Treat Linkwarden as an optional read-only integration. The Wake-on-LAN dashboard must continue to load and work when it is unconfigured or Linkwarden is unavailable.
- Fetch the configured collection only from the server. Provide a local read-only endpoint such as `GET /api/bookmarks`; the browser never contacts Linkwarden directly.
- During implementation, verify the installed Linkwarden version's documented collection/bookmark endpoint, authorization header, response pagination, and collection-access behavior before fixing the request shape. Request only the configured collection and do not add bookmark editing, deletion, or account-management features.
- Render a compact, accessible Bookmarks section in the existing dashboard. Show a title, safe external link, and available description/tags; use clear empty, loading, unavailable, and refresh states without disrupting device management.
- Validate submitted setup data server-side: require an absolute `http` or `https` Linkwarden URL, a valid positive collection ID, and a non-empty key when initially connecting or replacing it. Normalize the base URL, reject malformed values with actionable, non-sensitive errors, and let the operator retain the existing key while changing only URL or collection ID.
- Make outbound requests bounded and predictable: use a timeout/abort signal, a response-size limit, conservative server-side cache with explicit refresh behavior, and one in-flight refresh per process. On failure, preserve a recent cached result when available and otherwise return a generic service-unavailable result.
- Normalize the remote payload into a small local view model (`id`, `name`, `url`, optional `description`, optional `tags`, and optional `favicon`). Validate URLs before returning them, omit malformed entries, escape via DOM text APIs in the client, and use `target="_blank" rel="noopener noreferrer"` for outbound links.
- Preserve the current LAN-only request policy and same-origin protections for the local endpoint. Do not make the Linkwarden URL user-controlled through a request, and never proxy arbitrary paths or URLs.

## Implementation sequence

1. Add the encryption-secret setting to `.env.example` and `src/config.js`. Extend the database schema with a singleton Linkwarden-configuration record that stores normalized URL, collection ID, encrypted key material, timestamps, and no plaintext secret. Define migration and key-rotation/re-encryption behavior before persisting credentials.
2. Create server-only credential-encryption and Linkwarden client modules. The client builds the verified collection-bookmark request from saved configuration, applies authorization, pagination handling, timeout, size limits, response normalization, and cache/fallback behavior. Keep cryptography and network access injectable so they can be tested without a real Linkwarden service.
3. Add local API endpoints for configuration status, connection test, create/update, and disconnect, plus `GET /api/bookmarks`. Never serialize the saved key; require same-origin, trusted-LAN requests for mutations; validate before saving; clear cached bookmarks after configuration changes; and return generic remote-service failures without credential details.
4. Extend `public/index.html`, `public/app.js`, and `public/styles.css` with an accessible Linkwarden setup/edit dialog, masked connection status, test/save/disconnect controls, and a compact Bookmarks section with refresh and non-blocking empty/unavailable states. Retain all current search, selection, device CRUD, and wake controls unchanged.
5. Add automated tests for encryption/decryption and no-secret serialization, setup validation, update-without-key preservation, disconnect behavior, request construction and authorization, pagination/normalization, timeout and stale-cache behavior, malicious/malformed remote data rejection, disabled mode, and local endpoint LAN/origin protections. Run the existing Wake-on-LAN tests as regression coverage.
6. Update deployment and troubleshooting documentation with the encryption-secret requirement, how to create a least-privilege/read-only Linkwarden API key and find a collection ID, website setup flow, Linkwarden reachability/TLS guidance, cache behavior, secure credential backup/rotation, and disconnect procedure.

## Acceptance criteria

- A trusted local operator can configure, test, update, and disconnect Linkwarden from the dashboard without editing application files or environment variables (apart from the one-time server encryption secret).
- With valid configuration, the dashboard displays only bookmarks from the selected Linkwarden collection and opening one safely navigates to its saved URL.
- The Linkwarden API key is never sent to or discoverable by the browser, and the server never acts as an arbitrary outbound proxy.
- Saved API keys are encrypted at rest with a server-held encryption secret, and status/configuration endpoints never reveal the secret.
- When Linkwarden is disabled, slow, unavailable, or returns malformed data, device management and Wake-on-LAN continue to work and the bookmark section gives a clear, non-sensitive status.
- Remote data and links are validated before rendering; external links do not give the opened page access to the dashboard window.
- Automated tests cover normal retrieval, credentials/configuration validation, cache/error behavior, response sanitization, and preservation of the existing local-network boundary.
