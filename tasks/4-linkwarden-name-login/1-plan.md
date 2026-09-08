# Linkwarden name-based login plan

## Goal

Replace the Linkwarden setup's collection-ID and API-key flow with a username-and-access-token login flow that lets the trusted dashboard operator choose a collection by name. The browser must continue to receive no credential material.

## Scope and decisions

- The setup form will ask for the Linkwarden base URL, username, access token, and collection name. It will not expose a numeric collection ID to the operator.
- Before implementation, verify the deployed Linkwarden API version's authentication contract and collection-list response. Use the access token in the documented server-side authorization header and include the username only where the API requires it; do not invent a client-side password exchange.
- The server will resolve the selected collection name against the authenticated account, reject no-match and ambiguous-name results with actionable non-sensitive errors, and retain the resolved stable collection ID internally only because the bookmark endpoint requires it.
- Persist the normalized collection name, resolved collection ID, username, and AES-256-GCM encrypted access token in the singleton configuration record. Migrate existing configured records deliberately: retain their resolved ID, initialize a display name from a verified collection lookup when possible, and require re-authentication rather than guessing a username or plaintext token.
- Replace all `apiKey` naming at the configuration boundary with `accessToken`; ensure status and configuration responses expose only non-secret state, URL, username, collection name, and timestamps. Never serialize the encrypted record, token, or authorization header.
- Extend the server-only Linkwarden client with authenticated collection discovery and name resolution, preserving its existing timeout, response-size limit, origin-restricted pagination, caching, malformed-data rejection, and generic remote failures.
- Add local protected endpoints or extend the existing test/save flow so test-login validates credentials and resolves the exact requested collection before configuration is persisted. Configuration updates may retain the encrypted token when the token input is blank, but require a username and collection name.
- Update the dialog to remove the numeric collection-ID control, label credentials as username and access token, provide collection-name guidance, preserve masked configured status, and keep test/save/disconnect behavior accessible on desktop and mobile.
- Keep Wake-on-LAN operational if authentication fails, the integration is disconnected, or Linkwarden is unavailable. Do not add an arbitrary outbound proxy, remote browser requests, bookmark mutation, or account-management functions.

## Implementation sequence

1. Inspect the installed/deployed Linkwarden API contract for token authentication and collection discovery, then add fixtures representing its collection and error payloads.
2. Migrate the SQLite configuration schema and store mapping for username, collection name, resolved collection ID, and encrypted access-token material. Define safe behavior for existing ID-and-key configuration rows and clear caches after migration or replacement.
3. Rename and extend the server-side validation, encryption, and Linkwarden client APIs for username/access token handling and collection-name resolution. Keep remote dependencies injectable for tests.
4. Update protected API status, test, save, disconnect, and bookmark retrieval handlers so save/test resolve a unique collection name server-side and bookmark retrieval uses only saved resolved settings.
5. Update the Linkwarden dialog and client state to collect username, access token, and collection name, render only masked configuration status, and show validation or unavailable states without affecting device management.
6. Add tests for credential secrecy, username/token validation, unique/no-match/ambiguous collection-name resolution, retained-token updates, migration behavior, authorization headers, failed authentication, and regression coverage for cache, bookmark normalization, local-network/origin protections, and Wake-on-LAN.
7. Update `.env.example` and deployment documentation to describe access-token creation, username requirements, collection-name matching, credential rotation, migration/re-authentication behavior, and the existing encryption-secret backup requirement.

## Acceptance criteria

- A trusted operator can configure Linkwarden using a username, access token, and collection name without entering a numeric ID.
- The server resolves one matching collection and fetches only that collection's bookmarks using a stable internal ID.
- Access tokens remain encrypted at rest and are absent from browser responses, logs, errors, and static assets.
- Duplicate or missing collection names and invalid credentials produce clear non-sensitive feedback, while Wake-on-LAN remains functional.
- Existing configuration is migrated safely or explicitly prompts for re-authentication; no credentials are silently discarded or exposed.
- Automated tests cover authentication, name resolution, persistence/migration, secure serialization, failure handling, and existing dashboard behavior.
