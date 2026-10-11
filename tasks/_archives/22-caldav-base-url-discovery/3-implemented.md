# Task 22: CalDAV Base URL Discovery Implementation

## Outcome

Updated the project from version `0.13.3` to `0.14.0`. Users now enter only a Baikal server URL such as `https://baikal.example.com`, username, and password. The server discovers all event-capable calendars for the authenticated account and merges their upcoming events into the existing bounded agenda.

## Protocol Changes

- Replaced exact collection URL normalization with root-only `serverUrl` normalization. Credentials, queries, fragments, unsupported protocols, and `/dav.php/` or collection paths are rejected.
- Added authenticated CalDAV discovery through `/.well-known/caldav`, `DAV:current-user-principal`, `CALDAV:calendar-home-set`, and a depth-1 calendar-home `PROPFIND`.
- Added namespace-aware extraction of response hrefs, resource types, and supported component sets. Event calendars with explicit `VEVENT` support or no component metadata are included; task-only and non-calendar resources are excluded.
- Resolves every discovered href against the response URL and requires the configured origin. Cross-origin, credential-bearing, query-bearing, and fragment-bearing targets are rejected.
- Generalized the native HTTP(S) requester for `PROPFIND` and `REPORT`, while preserving method/body across at most five safe redirects, response limits, scoped CA trust, hostname verification, and protocol-upgrade rejection.
- Regenerates Digest authorization for the actual post-redirect method and URI, tracks nonce counts per nonce, and supports Digest challenges on both discovery and calendar reports.
- Handles the deployed reverse proxy's malformed same-host HTTPS-to-HTTP well-known redirect without downgrading: only its path is retained and the configured HTTPS origin remains in use. All true cross-origin and other downgrade redirects remain rejected.
- Discovers at most 20 event calendars and runs at most four REPORT requests concurrently under one overall timeout. Calendar data is merged before global recurrence handling, deduplication, sorting, and the existing 10-event limit.
- Rediscovers collections after cache expiry and explicit refresh so calendar and permission changes do not require reconnecting.

## Parser and Safety Changes

- Generalized the bounded non-evaluating XML parser to retain only resolved node names, required attributes, children, and text. Namespace maps remain only on the depth-bounded parser stack.
- Added a 64-attribute per-element limit and retained only the component `name` attribute, preventing namespace and attribute memory amplification within the response-size limit.
- Added support for response-level WebDAV status failures in addition to propstat statuses, preventing failed reports from being cached as successful empty calendars.
- Preserved the 2 MiB response and aggregate calendar-data bounds, 20,000-element and 64-depth XML bounds, 1,000 calendar-object bound, 500 event-candidate bound, and all existing iCalendar safety checks.
- Authentication, authorization, malformed discovery, unsafe href, unsupported method, and protocol failures remain non-transient. Only temporary network, timeout, rate-limit, and server failures can use stale cached events.

## Persistence and API Changes

- Changed `caldav_config.collection_url` to `base_url` and all store/API/client fields from `collectionUrl` to `serverUrl`.
- Added an atomic, idempotent startup migration that converts an existing exact collection URL to its HTTP(S) origin while preserving the encrypted password fields, username, ID, and timestamps without decrypting or re-encrypting the password.
- Kept test-before-save reconnect behavior, serialized connect/disconnect mutations, unchanged-identity blank-password retention, encrypted-at-rest passwords, and safe public event filtering.
- API status exposes only the normalized server origin and username. Principal, calendar-home, collection/resource hrefs, authorization values, UIDs, and raw XML/iCalendar remain server-private.

## Dashboard and Documentation Changes

- Changed calendar settings to request a “Baikal server URL” with a root URL placeholder and automatic-discovery guidance.
- Updated the browser controller and settings form to submit, store, and prefill `serverUrl` while preserving password, cancellation, refresh, stale-state, and disconnect behavior.
- Updated the README with base URL setup, all-event-calendar aggregation, discovery limits, four-request concurrency, refresh-time rediscovery, migration behavior, same-origin rules, scoped CA trust, and the read-only feature boundary.

## Tests Added and Updated

- Added base-origin validation and exact-path rejection tests.
- Added principal, calendar-home, multiple-calendar, duplicate href, component filtering, no-calendar, excessive-calendar, unsafe href, malformed XML, attribute-bound, and response-level status coverage.
- Added Basic/Digest discovery and REPORT coverage, per-nonce count handling, replacement nonce handling, post-redirect Digest URI hashing, same-origin redirect preservation, malformed same-host downgrade normalization, and cross-origin rejection.
- Added four-request concurrency, global merge, cache, stale, timeout, response-size, TLS, private-CA, and hostname verification coverage.
- Added legacy database migration and idempotency coverage proving ciphertext and timestamps are preserved.
- Updated API, browser-controller, and static dashboard tests for `serverUrl`, root-only payloads, safe metadata, and removal of exact collection guidance.

## Verification

- `node --test test/caldav.test.js`: passed, 25 tests.
- `node --test test/calendar-api.test.js`: passed, 2 tests.
- `node --test test/dashboard.test.js test/dashboard-calendar.test.js`: passed, 21 tests.
- `npm test`: passed, 112 tests.
- `npm run check`: passed.
- `git diff --check`: passed.
- Independent targeted review: all three reported protocol-hardening findings fixed; no remaining concrete correctness or security findings.

## Live Baikal Check

- An unauthenticated `PROPFIND` to `https://webdav.lan/.well-known/caldav` reached the deployed reverse proxy and returned HTTP 302 with the incorrect absolute location `http://webdav.lan/dav.php`.
- An unauthenticated `PROPFIND` to the safe HTTPS equivalent `https://webdav.lan/dav.php` reached SabreDAV 4.7.0 and returned the expected HTTP 401 Digest challenge for realm `BaikalDAV` with `qop=auth`.
- The implementation includes and tests safe HTTPS-origin retention for this redirect shape. A full authenticated live discovery/report was not run because Baikal credentials were not supplied.
- The endpoint's private certificate was inspected with curl's insecure mode only; application TLS behavior continues to require the scoped `CALDAV_CA_FILE` and is covered by the HTTPS fixture.

## Plan Departures

- The plan required rejecting protocol-changing redirects. The live Baikal reverse proxy advertises an incorrect same-host HTTP location for its HTTPS well-known endpoint, so the implementation safely retains the configured HTTPS origin while accepting only that redirect's path. It never sends credentials over the advertised HTTP URL.
- No browser was available for interactive visual verification. Static markup and browser-controller tests cover the changed settings workflow.

## Follow-up

- Version `0.14.1` replaces the generic “CalDAV is currently unavailable” response with safe stage-specific diagnostics for discovery and calendar queries. HTTP 429/5xx, DNS resolution, refused/reset connections, unreachable networks, and transport timeouts now remain actionable without exposing private upstream response bodies or credentials.
- Version `0.14.2` handles a live Baikal/SabreDAV 4.7.0 expansion defect. The test calendar advertises `calendar-timezone` as plain `Europe/Paris`; SabreDAV expects a serialized `VCALENDAR` and returns HTTP 500 while preparing expansion. The client now retries only a failed HTTP 500 expanded REPORT without `<c:expand>`, allowing the calendar to connect while documenting that recurring instances may be incomplete in fallback mode.
- Authenticated live verification with the provided test account and `/home/ubuntu/workdir/webdav.lanCA.crt` passed discovery, Digest authentication, collection filtering, HTTP 500 fallback, the unexpanded REPORT, and safe empty-calendar parsing.
