# Linkwarden name-based login plan

## Goal

Replace the Linkwarden setup's collection-ID and API-key flow with a username-and-access-token login flow that lets the trusted dashboard operator choose a collection by name. The browser must continue to receive no credential material.

## Scope and decisions

- The setup form will ask for the Linkwarden base URL, username, and access token, then list every collection available to the authenticated account for the operator to select by name. It will not expose or require a numeric collection ID.
- Before implementation, verify the deployed Linkwarden API version's authentication contract and collection-list response. Use the access token in the documented server-side authorization header and include the username only where the API requires it; do not invent a client-side password exchange.
- A protected server endpoint will retrieve all authenticated collections on demand and return only safe selection fields. The UI will render the complete collection list by name, including an accessible loading, empty, and unavailable state. Where names are duplicated, the server will provide a non-numeric opaque selection token so the operator can select the intended named collection without receiving an ID.
- The server will validate the chosen name and opaque selection token against the authenticated collection list, reject stale or mismatched selections with actionable non-sensitive errors, and retain the resolved stable collection ID internally only because the bookmark endpoint requires it.
- Persist the normalized collection name, resolved collection ID, username, and AES-256-GCM encrypted access token in the singleton configuration record. Migrate existing configured records deliberately: retain their resolved ID, initialize a display name from a verified collection lookup when possible, and require re-authentication rather than guessing a username or plaintext token.
- Replace all `apiKey` naming at the configuration boundary with `accessToken`; ensure status and configuration responses expose only non-secret state, URL, username, collection name, and timestamps. Never serialize the encrypted record, token, or authorization header.
- Extend the server-only Linkwarden client with authenticated collection discovery and name resolution, preserving its existing timeout, response-size limit, origin-restricted pagination, caching, malformed-data rejection, and generic remote failures.
- Add a local protected collection-list endpoint plus extend the existing test/save flow so credentials are validated, all collections can be listed, and the selected collection is resolved before configuration is persisted. Configuration updates may retain the encrypted token when the token input is blank, but require a username and selection.
- Update the dialog to remove the numeric collection-ID control, label credentials as username and access token, provide a list-all-collections action and named collection selector, preserve masked configured status, and keep test/save/disconnect behavior accessible on desktop and mobile.
- Keep Wake-on-LAN operational if authentication fails, the integration is disconnected, or Linkwarden is unavailable. Do not add an arbitrary outbound proxy, remote browser requests, bookmark mutation, or account-management functions.

## Implementation sequence

1. Inspect the installed/deployed Linkwarden API contract for token authentication and collection discovery, then add fixtures representing its collection and error payloads.
2. Migrate the SQLite configuration schema and store mapping for username, collection name, resolved collection ID, and encrypted access-token material. Define safe behavior for existing ID-and-key configuration rows and clear caches after migration or replacement.
3. Rename and extend the server-side validation, encryption, and Linkwarden client APIs for username/access token handling, complete collection listing, opaque selection tokens, and selected-collection resolution. Keep remote dependencies injectable for tests.
4. Update protected API status, collection-list, test, save, disconnect, and bookmark retrieval handlers so the browser can list all available collections by name while save/test resolve only the selected server-validated collection.
5. Update the Linkwarden dialog and client state to collect username and access token, load and render the full collection list for selection by name, render only masked configuration status, and show validation or unavailable states without affecting device management.
6. Add tests for credential secrecy, username/token validation, complete collection listing, duplicate-name opaque selection, stale selection rejection, retained-token updates, migration behavior, authorization headers, failed authentication, and regression coverage for cache, bookmark normalization, local-network/origin protections, and Wake-on-LAN.
7. Update `.env.example` and deployment documentation to describe access-token creation, username requirements, listing and selecting collections by name, credential rotation, migration/re-authentication behavior, and the existing encryption-secret backup requirement.

## Acceptance criteria

- A trusted operator can configure Linkwarden using a username and access token, then choose from all authenticated collections by name without entering or seeing a numeric ID.
- The server resolves one matching collection and fetches only that collection's bookmarks using a stable internal ID.
- Access tokens remain encrypted at rest and are absent from browser responses, logs, errors, and static assets.
- Empty collection lists, duplicate collection names, stale selections, and invalid credentials produce clear non-sensitive feedback, while Wake-on-LAN remains functional.
- Existing configuration is migrated safely or explicitly prompts for re-authentication; no credentials are silently discarded or exposed.
- Automated tests cover authentication, complete collection listing and selection, persistence/migration, secure serialization, failure handling, and existing dashboard behavior.
