# Task 22: Discover Baikal Calendars from the Base URL

## Objective

Allow the dashboard calendar to connect with only a Baikal server base URL such as `https://baikal.example.com`, username, and password. Discover the authenticated account's event-capable calendar collections through CalDAV instead of requiring the user to enter `/dav.php/calendars/...` paths.

## Request and Scope

- Request from `~/workdir/command.md`: “Use just `https://baikal.example.com` without `/dav.php/~`.”
- Replace the user-facing exact collection URL with a server base URL. The submitted URL must contain only the HTTP(S) origin; normalize it to one trailing slash.
- Use standards-based CalDAV discovery rather than constructing a Baikal path from the username or assuming a calendar collection is named `default`.
- Discover every readable collection that advertises the CalDAV `calendar` resource type and supports `VEVENT`, then merge its upcoming events into the existing single agenda.
- Keep the existing read-only 14-day, 10-event, encrypted-credential, scoped-private-CA, Basic/Digest, caching, and browser behavior unless discovery requires a targeted change.
- Calendar selection, per-calendar labels/colors, write operations, address books, tasks, invitations, and generic non-CalDAV WebDAV browsing remain out of scope.

## Inspected Context

- The project is version `0.13.3`, requires Node 24, has no package dependencies, and uses native Node HTTP(S), SQLite, browser modules, and `node:test`.
- `src/caldav.js` currently validates and queries one exact `collectionUrl`. Its request helper is hard-coded to `REPORT`; authentication, redirect safety, timeout, response bounds, XML parsing, event parsing, cache generation, and stale fallback are already centralized there.
- The current Digest retry hashes the configured request path. Discovery can redirect `/.well-known/caldav` to `/dav.php/`, so authentication must bind the Digest response to the actual request URI after accepted redirects.
- The existing XML tokenizer extracts only `calendar-data` and WebDAV status values. Discovery additionally needs bounded extraction of `current-user-principal`, `calendar-home-set`, response `href`, `resourcetype`, and `supported-calendar-component-set`.
- `src/app.js`, `src/db.js`, and `test/calendar-api.test.js` consistently store, compare, expose, and test `collectionUrl`; the persisted `caldav_config.collection_url` therefore needs a deliberate migration to base-URL semantics.
- `public/dashboard.html`, `public/dashboard.js`, and `public/dashboard-calendar.js` label, prefill, submit, and normalize an exact collection URL. These changes are limited to connection settings and status metadata; event rendering does not need a redesign.
- The current README explicitly says discovery and multiple calendars are unsupported and documents an exact collection URL, so its protocol and setup guidance must be replaced.

## Protocol and Product Decisions

- Normalize input to `serverUrl = <scheme>://<host>[:port]/`. Reject credentials, query strings, fragments, unsupported protocols, and non-root paths with an actionable “enter only the server base URL” message.
- Start discovery at `/.well-known/caldav` on the submitted origin. Follow at most five same-origin redirects, preserving method and body. Reject cross-origin discovery, principal, home, collection, and redirect URLs so credentials and private calendar data cannot leave the configured origin.
- Perform authenticated bounded `PROPFIND` requests for `DAV:current-user-principal`, `CALDAV:calendar-home-set`, then a depth-1 listing of the calendar home requesting `DAV:resourcetype` and `CALDAV:supported-calendar-component-set`.
- Resolve relative `href` values against the URL that produced each response, normalize them, reject credentials/query/fragment/cross-origin targets, and deduplicate discovered collection URLs.
- Include collections whose resource type contains `CALDAV:calendar` and whose supported component set contains `VEVENT`; tolerate an absent component-set property for Baikal compatibility, but exclude collections that explicitly advertise only non-event components.
- Query all discovered event-capable calendars and merge their calendar objects before the existing global normalization, overlap filtering, deduplication, ordering, and 10-event limit. Do not choose a collection by display name or URI because neither identifies a portable default calendar.
- Cap discovery at 20 calendar collections and use one overall timeout/abort scope per refresh. Reject an account exceeding the bound with a safe actionable error rather than silently omitting calendars.
- Treat no discovered event calendar as a connection error. Treat authentication, authorization, unsafe URLs, malformed discovery XML, and unsupported discovery as non-transient; retain the existing stale snapshot only for transient network, timeout, rate-limit, and server failures.
- Keep persisted credentials as `{ serverUrl, username, encryptedPassword }`. Migrate an existing `collection_url` row to its origin so upgrades preserve credentials and rediscover collections on the next test or refresh; do not preserve the old exact path as active configuration.

## Implementation Plan

### 1. Generalize authenticated WebDAV requests

- Refactor `requestCalDav` in `src/caldav.js` into a bounded same-origin WebDAV request helper that accepts `PROPFIND` and `REPORT`, request-specific depth/body/content type, the configured origin, abort signal, and scoped CA.
- Preserve method/body on same-origin redirects and return or retain the final request URL so Digest authorization hashes the actual redirected URI. Do not forward an authorization value whose Digest URI was generated for a prior path.
- Centralize Basic/Digest negotiation for both methods. Generate Digest responses with the actual method and URI, bounded challenge parsing, secure cnonce generation, and nonce-count handling; continue supporting MD5, MD5-sess, SHA-256, SHA-256-sess, and `qop=auth`.
- Keep normal TLS and hostname verification, the existing 2 MiB per-response limit, protocol-upgrade rejection, redirect bound, safe error conversion, and injectable request/random/clock seams.

### 2. Add bounded CalDAV discovery

- Add fixed XML builders for the three discovery `PROPFIND` requests. Send `Depth: 0` for principal/home properties and `Depth: 1` only when listing calendar collections.
- Extend or reuse the non-evaluating XML tokenizer to parse namespace-aware WebDAV multistatus responses and successful propstats for only the discovery properties. Preserve all current DTD/entity, malformed XML, depth, element, text, object-count, and response-size protections.
- Implement a discovery pipeline from base origin to well-known endpoint, authenticated principal, calendar home, and bounded event-calendar URL list. Require successful 207 responses and the expected property at each stage; classify missing properties and unsupported methods with safe discovery-specific messages.
- Resolve every server-provided URL through one validator that requires the configured origin and HTTP(S), strips no meaningful path data, and rejects embedded credentials, query strings, and fragments.
- Add a maximum discovered-calendar count and deterministic URL ordering. Deduplicate repeated collection responses before issuing reports.

### 3. Query and merge discovered calendars

- Change the CalDAV client settings and cache fingerprint from `collectionUrl` to `serverUrl`.
- During `test()` and uncached refresh, discover collections and issue the existing bounded `calendar-query` REPORT against each collection under the same overall abort deadline.
- Query discovered calendars with at most four REPORT requests in flight so an account with many calendars cannot create an unbounded request burst. Enforce the existing global calendar-object, candidate-event, output-string, and 10-event limits across all responses, not independently per calendar.
- Merge calendar data before `parseCalendarEvents()` so cancellation, recurrence override, UID deduplication, overlap filtering, and ordering remain globally consistent.
- Keep cache/stale behavior keyed by base URL, username, and password. Rediscover collections after cache expiry or forced refresh so added, removed, or permission-changed calendars take effect without reconnecting.
- Update status errors to refer to the Baikal server/discovery process rather than an exact collection URL, while preserving distinct authentication and authorization kinds used by the API and browser retry suppression.

### 4. Migrate persistence and API metadata

- Update `caldav_config` to store `base_url` rather than `collection_url`. Add a startup migration for existing databases that converts a valid saved collection URL to its origin and preserves encrypted password fields and timestamps atomically.
- Update store mappings and save methods to use `serverUrl`; prove the migration does not decrypt or rewrite the saved password and remains safe if startup is repeated.
- Update `src/app.js` status, saved-settings, unchanged-identity/password-retention checks, connect flow, and safe API response fields from `collectionUrl` to `serverUrl`.
- Keep PUT atomicity: discover/query successfully before saving the new base URL and encrypted password; preserve the previous working configuration after any failed discovery or query.
- Do not accept or return upstream collection URLs, principal URLs, calendar-home URLs, resource hrefs, raw XML/iCalendar, UIDs, or authorization values through the API.

### 5. Simplify dashboard connection settings

- Change the settings copy, label, and placeholder in `public/dashboard.html` to request a Baikal server URL such as `https://baikal.example.com`.
- Update `public/dashboard-calendar.js` status normalization and connect payload to use `serverUrl`, retaining the existing length bounds, password handling, mutation deduplication, cancellation, and safe error rendering.
- Update `public/dashboard.js` form prefill/submission and connection messages without changing event presentation, visibility/scale preferences, refresh lifecycle, or disconnect behavior.
- Ensure a saved base URL is shown without any discovered private paths and that blank-password reconnect works only when normalized base URL and username are unchanged.

### 6. Add regression and protocol coverage

- Extend `test/caldav.test.js` for base-origin normalization and rejection of `/dav.php/`, collection paths, credentials, queries, fragments, and unsupported protocols.
- Add discovery fixtures covering same-origin well-known redirects, relative/absolute href resolution, namespace-prefix variations, principal and home lookup, multiple calendars, duplicate hrefs, explicit VEVENT support, absent component metadata, non-event collection exclusion, empty discovery, and calendar-count bounds.
- Verify Basic and Digest authentication on `PROPFIND` and `REPORT`, including Digest method/path hashing after the well-known redirect, response-body cancellation before retries, and rejection of unsupported challenges or cross-origin redirects/hrefs.
- Cover malformed/unsafe/oversized discovery XML, failed propstats, missing required properties, unsupported status codes, one overall timeout, request concurrency bounds, and transient versus non-transient stale behavior.
- Verify events from multiple calendars are merged, globally deduplicated/sorted/capped, and refreshed collection discovery notices newly added calendars.
- Extend database/API tests for the `collection_url` to `base_url` migration, encrypted-password preservation, safe `serverUrl` metadata, retained-password identity checks, failed reconnect preservation, mutation ordering, and absence of discovered paths/private protocol data in responses.
- Extend dashboard/static tests for the server-URL label/placeholder, `serverUrl` payload/status handling, reconnect behavior, and removal of exact-collection guidance.

### 7. Documentation, release, and implementation record

- Rewrite the README Baikal setup to require only the server base URL and explain automatic discovery and aggregation of all event-capable calendars for the account.
- Document same-origin discovery, Basic/Digest support, private CA behavior, refresh-time rediscovery, bounds, read-only scope, and the migration of existing saved exact URLs to their origin.
- Remove claims that principals, calendar homes, and multiple collections are unsupported, while retaining credential encryption, backup, HTTPS, stale-state, 14-day, and 10-event guidance.
- Bump `package.json` from `0.13.3` to `0.14.0` for the user-visible connection and discovery behavior change.
- Write `tasks/22-caldav-base-url-discovery/3-implemented.md` with actual protocol choices, migration results, changed files, verification evidence, real-Baikal availability, and any departures from this plan before implementation changes are committed.

## Verification

Run from the repository root:

```bash
node --test test/caldav.test.js
node --test test/calendar-api.test.js
node --test test/dashboard-calendar.test.js
npm test
npm run check
git diff --check
```

Also verify:

1. Connect using only `https://baikal.example.com`, valid credentials, and a Baikal account with one calendar; confirm discovery reaches `/dav.php/` internally and events load without exposing that path in settings or API metadata.
2. Repeat with multiple event calendars plus address books/task-only collections; confirm only event calendars contribute and the final agenda remains globally ordered and capped at 10.
3. Confirm Basic and Digest Baikal configurations work through the well-known redirect, and private-CA trust remains scoped through `CALDAV_CA_FILE` with hostname verification active.
4. Confirm cross-origin redirects/hrefs, malformed discovery responses, missing principal/home properties, no event calendars, excessive calendars, bad credentials, denied access, timeout, and server outage produce safe actionable states without replacing saved working credentials.
5. Start with a version `0.13.3` database containing an exact collection URL; confirm startup migrates it to the origin, preserves encrypted credentials/timestamps, and reconnects through discovery without plaintext secret exposure.
6. Inspect API responses, browser state, process output, and SQLite values to confirm passwords, authorization values, principal/home/collection hrefs, UIDs, and raw XML/iCalendar are not exposed.
7. Confirm clock, weather, photos, Home Assistant, Linkwarden, and Wake-on-LAN behavior is unchanged when calendar discovery succeeds, fails, or is unconfigured.

## Acceptance Criteria

- A user connects the Baikal integration with only a root URL such as `https://baikal.example.com`, username, and password; no `/dav.php/` or collection path is requested in the UI.
- The client discovers the authenticated principal, calendar home, and bounded event-capable calendar collections using same-origin CalDAV/WebDAV requests and supports both Basic and Digest authentication.
- Upcoming events from all discovered event calendars are merged under the existing 14-day and 10-event limits without exposing discovered resource URLs or other private protocol data.
- Redirects and discovered hrefs cannot send credentials or data to another origin; TLS, timeout, response-size, XML, request-count, and calendar-count bounds remain enforced.
- Existing encrypted CalDAV configuration migrates from exact collection URL to base origin without losing or exposing the password, and failed reconnects preserve the previous working configuration.
- The dashboard, API, tests, README, implementation record, and version `0.14.0` consistently use `serverUrl`/base URL semantics.
- No dependency, build step, or installation requirement is introduced, and all existing plus new automated checks pass.

## Planning Verification

- Inspected task numbering, the current CalDAV HTTP/authentication/cache/XML/event client, persistence schema, API connection flow, dashboard form/controller, tests, README, and package metadata.
- Accounted for the current same-origin redirect rules, Digest request-URI requirement, persisted exact collection URLs, multiple-calendar ambiguity, and existing privacy/bounds guarantees.
- This planning task adds only `tasks/22-caldav-base-url-discovery/1-plan.md`; implementation code remains unchanged.
