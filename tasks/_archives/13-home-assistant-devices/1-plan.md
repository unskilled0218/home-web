# Task 13: Connect Home Assistant and Display Devices

## Objective

Add an optional, read-only Home Assistant integration that lets a LAN user save a Home Assistant URL and long-lived access token, validates the connection, and displays Home Assistant's device registry on the dashboard. Keep credentials server-side and encrypted, preserve the existing Bookmarks and Wake-on-LAN behavior, and retain the project's dependency-free Node/Compose deployment.

## Product Assumptions

- "Devices" means entries from Home Assistant's device registry, not every entity state.
- The first version is display-only. Service calls, entity controls, automations, event subscriptions, and importing Home Assistant devices into the Wake-on-LAN inventory are out of scope.
- Device cards show registry metadata that Home Assistant provides reliably: display name, area, manufacturer, model, and disabled state. They do not claim online/offline status because the device registry does not provide a trustworthy reachability value.
- Authentication uses a Home Assistant long-lived access token entered through dashboard settings. The browser never connects to Home Assistant directly and never receives the token.
- Home Assistant WebSocket connections use normal certificate and hostname verification. `http://`/`ws://` can be used on a trusted LAN; no TLS-verification bypass will be added.

## Implementation Plan

### 1. Add a bounded Home Assistant WebSocket client

- Create `src/home-assistant.js` with a small client built on Node 24's built-in `WebSocket`, injected through a `webSocketFactory` for deterministic tests.
- Normalize connection input before use:
  - require an absolute `http://` or `https://` URL;
  - reject embedded credentials, query strings, fragments, and unsupported protocols;
  - normalize trailing slashes and derive `ws://.../api/websocket` or `wss://.../api/websocket` from the saved origin;
  - require a non-empty long-lived access token and cap its accepted length.
- Implement the documented Home Assistant authentication state machine:
  1. wait for `auth_required`;
  2. send `{ "type": "auth", "access_token": ... }`;
  3. require `auth_ok` and reject `auth_invalid`;
  4. send integer-ID commands and correlate each `result` response by ID.
- Request `config/device_registry/list` and `config/area_registry/list`, then close the socket after both results arrive. Do not create a permanent event subscription for a read-only snapshot.
- Enforce a connection/response timeout, reject malformed or unexpected protocol messages, cap message bytes and registry entry counts before normalization, and always close the socket on success, failure, or timeout.
- Convert upstream records into a minimal browser-safe shape. Use `name_by_user`, then `name`, then model, then "Unnamed device"; resolve `area_id` through the area registry; trim and bound every returned string; sort by area and name; and omit identifiers, connections, config-entry IDs, URLs, and unknown upstream fields.
- Return generic connection/protocol errors to API callers. Never include the access token, raw WebSocket payloads, or upstream stack details in responses or logs.

### 2. Persist Home Assistant configuration securely

- Extend `src/db.js` with a singleton `home_assistant_config` table containing the normalized base URL, AES-GCM ciphertext/IV/tag for the access token, and timestamps.
- Add store methods to get, save/upsert, and remove Home Assistant configuration. Map rows to the existing encrypted-secret object shape and never expose plaintext from the store.
- Reuse the dashboard's existing persisted server encryption key and AES-256-GCM helpers so deployments do not need a second master key. Update user-facing documentation to describe this as the integration-credential encryption key while retaining the existing `LINKWARDEN_CONFIG_ENCRYPTION_KEY` and `_FILE` environment names for backward compatibility.
- Treat missing/invalid encryption configuration or decryption failure as "needs re-authentication" in status output rather than leaking cryptographic errors.
- When editing a saved connection, allow a blank token only if the normalized Home Assistant URL is unchanged. Require a new token when the URL changes.
- Test the proposed credentials against Home Assistant and fetch devices before persisting them. A failed connect attempt must leave the previously saved configuration unchanged.

### 3. Add Home Assistant API routes through the server factory

- Inject a Home Assistant client into `createDashboardServer()` and construct the production client in `src/server.js`, preserving the existing side-effect-free integration-test boundary.
- Add routes protected by the current private-address, Host, and Origin checks:
  - `GET /api/home-assistant`: return configuration status and safe saved metadata only;
  - `GET /api/home-assistant/devices`: return `{ configured, devices }`, or an empty unconfigured result without contacting an upstream;
  - `PUT /api/home-assistant`: validate the body, verify encryption readiness, test/fetch before save, then return safe status plus devices;
  - `DELETE /api/home-assistant`: remove saved credentials and return 204.
- Keep Home Assistant failures isolated from Bookmarks and Wake-on-LAN. Use 400 for invalid settings/authentication input and 503 for a saved upstream that is temporarily unavailable.
- Add a short per-configuration device snapshot cache and in-flight request deduplication inside the Home Assistant client. Support `?refresh=1` on the devices route to bypass the cache, clear cached data after reconnect/disconnect, and key the cache by normalized URL without exposing the token.
- Add `HOME_ASSISTANT_CACHE_SECONDS` to configuration, `.env.example`, and Compose with a documented default. Do not add token or URL environment variables; connection data remains encrypted in SQLite.

### 4. Add a Home Assistant dashboard section

- Insert a new accessible Home Assistant section between Bookmarks and Wake-on-LAN so the existing Bookmarks-first layout remains intact.
- Include:
  - a section heading and short read-only description;
  - connected-instance metadata;
  - **Home Assistant settings**, **Disconnect**, and **Refresh** actions;
  - a search input for filtering by device name, area, manufacturer, or model;
  - an `aria-live` loading/error/empty status;
  - responsive device cards grouped by area, with an "Unassigned" group when no area is present.
- Keep Home Assistant state separate from the existing Wake-on-LAN `devices` state by using explicit names such as `homeAssistant`, `homeDevices`, and `homeDeviceRequest`.
- Guard asynchronous loads with a request generation so stale refresh/connect responses cannot replace newer disconnect or reconnect state.
- Render all upstream values with DOM text properties, never HTML strings. Do not render upstream URLs or add outbound device links in this task.

### 5. Add accessible connection settings

- Add a dedicated `<dialog>` with `aria-labelledby`, a visible title, Home Assistant URL and long-lived-token fields, explanatory help, a dialog-local `role="alert"`, a close action, and a submit action.
- On open, prefill only the saved URL. Never return or refill the saved token; explain that blank retains the token only when the URL is unchanged.
- Keep validation and connection failures inside the open dialog. Disable the submit action while testing credentials, prevent duplicate submissions, and restore it in `finally`.
- On successful connection, close the dialog, update the safe account metadata and device cards from the atomic PUT response, and move focus/status feedback through the existing accessible patterns.
- Require confirmation before disconnecting, cancel stale device requests, clear rendered Home Assistant data immediately after a successful delete, and keep unrelated sections interactive.

### 6. Extend styling without changing the visual language

- Reuse the existing section, action, dialog, status, group, and card patterns in `public/styles.css`.
- Add only the Home Assistant-specific selectors needed for its search, grouped grid, metadata lines, disabled-device indicator, and loading/empty states.
- Preserve desktop density and the current mobile breakpoints. Verify the new action row, search input, cards, and dialog at narrow widths without horizontal overflow.

### 7. Add automated coverage

- Add unit tests for Home Assistant URL/token normalization and safe device/area normalization, including malformed payloads, duplicate/missing IDs, bounded strings, unknown areas, disabled devices, and deterministic sorting.
- Test the WebSocket state machine through an injected fake WebSocket:
  - successful authentication and correlated device/area commands;
  - invalid authentication;
  - command-level failure;
  - malformed/unexpected messages;
  - timeout and premature close;
  - message/entry bounds;
  - socket cleanup on every terminal path;
  - cache hits, forced refresh, in-flight deduplication, and cache clearing.
- Extend database tests to prove Home Assistant tokens are encrypted at rest, no plaintext token column exists, upsert works, and disconnect removes the singleton row without affecting Linkwarden configuration.
- Extend application-factory integration tests with an injected Home Assistant fake to cover status, initial connect, atomic failed reconnect, retained-token reconnect, URL-change token requirement, device listing/refresh, upstream failure, and disconnect.
- Add browser-helper tests for Home Assistant filtering/grouping and stale-response protection where logic can be extracted cleanly.
- Extend static markup tests to verify section order, unique IDs, dialog naming, local alert ownership, status semantics, and token-field password/autocomplete attributes.
- Keep all tests on `node:test`; do not add a browser framework or WebSocket package solely for testing.

### 8. Documentation and release update

- Update `README.md` with:
  - how to create a least-privilege Home Assistant long-lived access token;
  - the server-to-server WebSocket flow and `/api/websocket` requirement;
  - encrypted-at-rest behavior and backup requirements;
  - normal TLS verification and trusted-LAN guidance for plain HTTP;
  - read-only/device-registry limitations and manual refresh behavior;
  - disconnect and re-authentication behavior.
- Update the project description where it currently mentions only Linkwarden and Wake-on-LAN.
- Add `tasks/13-home-assistant-devices/3-implemented.md` during implementation with changed files, design decisions, and exact verification evidence.
- Bump the project minor version from `0.8.0` to `0.9.0` after all implementation checks pass.

## Verification

Run from the repository root:

```bash
npm test
npm run check
git diff --check
```

Also verify:

1. Start without Home Assistant configuration and confirm Bookmarks and Wake-on-LAN behave unchanged.
2. Connect to a Home Assistant fixture and confirm the token never appears in API responses, logs, static assets, or plaintext SQLite values.
3. Confirm a failed initial connection saves nothing and a failed reconnect preserves the last working configuration.
4. Confirm device cards are grouped/sorted, searchable, escaped as text, responsive, and refreshed only when requested or the cache expires.
5. Confirm auth rejection, timeout, malformed response, command failure, and temporary outage produce safe local errors without affecting other sections.
6. Keyboard-test the Home Assistant settings dialog, status announcements, search, refresh, disconnect, focus return, and narrow-screen layout.
7. Against a real Home Assistant instance when available, verify `/api/websocket` authentication and device/area registry compatibility with a least-privilege long-lived token.
8. If Docker is available, run `docker compose config` and start the stack to confirm the built-in WebSocket client requires no install step. Record Docker or real-Home-Assistant unavailability rather than claiming those checks passed.

## Acceptance Criteria

- A user can connect, update, and disconnect Home Assistant from the dashboard without exposing the long-lived token to the browser or storing it in plaintext.
- Connection settings are persisted only after successful authentication and device retrieval; failed reconnects do not destroy working credentials.
- The server follows Home Assistant's WebSocket authentication/result protocol with bounded input, timeouts, correlation, cleanup, and normal TLS verification.
- The dashboard displays normalized device-registry cards grouped by area and supports search and explicit refresh on desktop and mobile.
- Home Assistant failures are isolated and communicated through accessible section/dialog status regions.
- Existing Linkwarden and Wake-on-LAN behavior remains intact.
- Automated tests cover protocol, persistence, API, and browser-state behavior, and all existing tests continue to pass.
- Documentation, environment examples, Compose configuration, implementation record, and version `0.9.0` match the delivered behavior.
