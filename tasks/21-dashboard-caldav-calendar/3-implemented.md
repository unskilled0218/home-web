# Task 21: Baikal CalDAV Calendar Implementation

## Outcome

Implemented the optional read-only Baikal CalDAV agenda on `/dashboard` and updated the project from version `0.12.3` to `0.13.1`. Users can connect one exact calendar collection with Basic authentication, display up to 10 events overlapping the next 14 days, refresh explicitly or every five minutes while visible, retain only transiently stale snapshots, and disconnect encrypted server-side credentials.

## Server and Protocol Changes

- Added `src/caldav.js`, a dependency-free CalDAV client using Node HTTP(S) APIs.
- Added normalized exact collection URL, username, and password handling. Collection URLs retain their Baikal path, normalize to one trailing slash, and reject embedded credentials, queries, fragments, unsupported protocols, and ambiguous colon-bearing usernames.
- Added depth-1 `calendar-query` REPORT requests with matching UTC time-range and recurrence-expansion windows, fixed property selection, UTF-8 Basic authentication, 8-second timeouts, a 2 MiB response limit, same-origin redirect enforcement, protocol-upgrade rejection, and scoped CA support.
- Added bounded namespace-aware XML parsing that rejects declarations beyond the XML declaration, DTD/entity input, malformed nesting/entities/status lines, excessive depth/elements/data, and failed WebDAV propstats. Empty successful collections remain valid.
- Added bounded iCalendar parsing for folded lines, escaped text, VEVENT components, UTC/offset/TZID timestamps, all-day dates, `DTEND`, RFC `DURATION`, default event durations, cancellations, recurrence identities, server-expanded overrides, deduplication, overlap filtering, sorting, and output limits.
- Added cache expiry, in-flight deduplication, explicit refresh, generation-safe cache clearing, and stale fallback only for transient network/timeout/429/5xx failures. Authentication, authorization, protocol, and malformed-response failures evict cached private events.
- Added a singleton `caldav_config` SQLite table and `getCalDav`, `saveCalDav`, and `removeCalDav` store methods. Passwords use the existing AES-256-GCM integration encryption key and are stored only as ciphertext, IV, and authentication tag.
- Added safe `GET /api/calendar`, `GET /api/calendar/events`, `PUT /api/calendar`, and `DELETE /api/calendar` routes with atomic configuration mutation ordering, retained-password identity checks, test-before-save behavior, explicit public event filtering, forced refresh, safe re-authentication signaling, and generic temporary-upstream errors.
- Added `CALDAV_CACHE_SECONDS` with a 300-second default and scoped `CALDAV_CA_FILE` loading. The reusable scoped loader validates certificate-only PEM before extending the normal root set; hostname, chain, and validity checks remain enabled.

## Dashboard Changes

- Added a transparent Calendar agenda after weather with accessible loading, unconfigured, empty, stale, unavailable, and re-authentication states.
- Added safe DOM rendering for event date, time, title, and optional location. Timed events use the selected dashboard timezone; all-day dates use stable UTC-noon date formatting to avoid timezone drift.
- Added browser-local calendar visibility and 0.5-2 scale preferences.
- Added a Baikal connection form to dashboard settings with exact collection URL, username, non-prefilled password, connect, and confirmed disconnect actions. Both mutation controls lock during either operation.
- Added `public/dashboard-calendar.js` with status/event loading, five-minute visible-page refresh, forced refresh, timer ownership, cancellation, stale-response protection, reconnect/disconnect handling, bounded response normalization, and re-authentication snapshot clearing without automatic rejected-credential retries.
- Integrated calendar work with existing settings, visibility, fullscreen/photo/weather layout, page lifecycle, responsive presentation, keyboard focus styles, and right-aligned information mode.

## Tests and Documentation

- Added protocol tests for REPORT construction, Basic authentication, redirects, WebDAV propstats, XML safety, iCalendar formats, durations, recurrence cancellation/override order, timezone/DST conversion, bounds, cache behavior, stale policy, timeout/status classification, and cache-generation races.
- Added a real HTTPS fixture proving private-CA rejection by default, scoped trust success, and continued hostname verification.
- Added API/database tests for encrypted-at-rest passwords, absence of plaintext columns/values, safe event responses, retained-password reconnect, changed-identity rejection, failed reconnect preservation, forced refresh, re-authentication, disconnect, and connect/disconnect ordering.
- Added browser-controller tests for timezone/all-day formatting, five-minute timers, visibility/enable pause, forced refresh, stale state, duplicate submission, obsolete request cancellation, untrusted response filtering, and authentication snapshot clearing/retry suppression.
- Extended dashboard, CA, and runtime configuration tests for the new asset, markup, styles, preferences, scoped CA loader, and environment settings.
- Updated `.env.example`, `docker-compose.yml`, `README.md`, and the package description/version with Baikal setup, exact collection URL requirements, encryption/backup behavior, scoped private CA instructions, refresh/query limits, read-only scope, and the trusted-LAN warning for plain HTTP Basic authentication.

## Plan Departures

- Added `DURATION` to the requested and parsed event fields. The plan specified a default when `DTEND` is absent, but RFC 5545 also permits `DTSTART` plus `DURATION`; supporting it prevents valid timed and multi-day events from becoming zero-length.
- Authentication failures receive explicit API/browser re-authentication handling instead of the generic saved-upstream 503 path. This ensures rejected credentials immediately clear cached private events and stop automatic retries.
- Scoped private-CA behavior was verified with a generated HTTPS fixture, not a live Baikal deployment.

## Verification

- `npm test`: passed, 102 tests, 0 failures, 0 skipped.
- `npm run check`: passed for all `src/*.js` and `public/*.js` files.
- `git diff --check`: passed.
- Focused implementation review: no remaining findings after fixes for stale authentication data, RFC durations, WebDAV propstats, mutation controls, scoped TLS, and rejected-credential retry behavior.
- OpenSSL-backed scoped CalDAV TLS fixture: passed, including untrusted rejection, configured trust, and hostname mismatch rejection.
- Docker Compose runtime verification: unavailable because `docker` is not installed in the environment.
- Interactive desktop/mobile/browser verification: unavailable because Chromium, Chrome, and Firefox executables are not installed.
- Live Baikal verification: unavailable because no Baikal endpoint or credentials were provided; compatibility is covered by deterministic RFC-shaped HTTP(S) fixtures.

## Baikal Compatibility Follow-Up

- Simplified the REPORT request in version `0.13.1` to match RFC 4791 section 7.8.3 and SabreDAV's documented expanded-query shape exactly: `calendar-data` now contains only `expand`, while the VEVENT time range remains in the query filter.
- Removed partial component/property selection from the request because older Baikal/SabreDAV combinations can reject the otherwise valid combination of partial retrieval and expansion. Response parsing still allowlists and bounds every field exposed by the application.
- Split HTTP rejection messages so HTTP 405 identifies a collection URL or reverse-proxy method problem, while HTTP 400/415/422/501 identifies a Baikal query rejection and reminds the user to supply an exact calendar collection URL.
