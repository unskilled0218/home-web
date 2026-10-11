# Task 21: Add a Baikal CalDAV Calendar to the Dashboard

## Objective

Add an optional upcoming-events agenda to `/dashboard` backed by a self-hosted Baikal CalDAV calendar collection, while keeping Basic-auth credentials encrypted and server-side, supporting private CA trust, and preserving the project's dependency-free Node deployment.

## Request and Scope

- Request from `~/workdir/command.md`: “dashboard - webdav calendar.”
- The user confirmed the source is a CalDAV calendar collection hosted by Baikal, in the same self-hosted environment as Linkwarden and Home Assistant.
- Display upcoming events from one configured calendar collection. This task does not discover principals, calendar homes, or multiple collections; the user supplies the exact collection URL, for example `https://baikal.example.test/dav.php/calendars/user/default/`.
- Present a compact agenda in the existing clock/weather information overlay rather than a month-grid editor. Calendar creation, event editing, invitations, tasks, attachments, alarms, attendee status, and WebDAV file browsing are out of scope.
- Use CalDAV over HTTP(S) with Basic authentication. Do not expose the Baikal password, collection resource URLs, event UIDs, or raw iCalendar payloads to the browser.

## Inspected Context

- The project is version `0.12.3`, requires Node 24, uses native browser modules and `node:test`, and currently has no package dependencies or installation step.
- `src/app.js`, `src/db.js`, and `src/server.js` already provide server-side integration injection, encrypted singleton configuration, safe status endpoints, atomic connect/disconnect behavior, local-network/Host/Origin protections, and cache clearing patterns for Linkwarden and Home Assistant.
- `src/linkwarden.js` provides bounded HTTP(S), timeout, same-origin redirect, scoped CA, in-flight deduplication, cache, forced refresh, and stale-fallback patterns that can be adapted for a CalDAV `REPORT` request.
- `src/linkwarden-crypto.js` and the persistent integration encryption key already protect Linkwarden and Home Assistant secrets with AES-256-GCM. The legacy `LINKWARDEN_CONFIG_ENCRYPTION_KEY` names are intentionally shared across integrations.
- `src/ca-file.js`, `src/linkwarden-ca.js`, `.env.example`, and `docker-compose.yml` provide private-CA validation/loading and deployment conventions. Baikal needs a separate scoped CA setting so trust is not widened process-wide.
- `/dashboard` has independent HTML, CSS, JavaScript, settings, and controller lifecycles. Browser-local preferences already support visibility/scaling and pause weather/photo work while hidden.
- RFC 4791 defines `calendar-query`, `time-range`, and `calendar-data` expansion for retrieving calendar objects that overlap a bounded interval. Baikal is based on SabreDAV and should be addressed through its exact calendar collection URL rather than as a direct `.ics` file.

## Product and Protocol Decisions

- Query from the current instant through 14 days ahead and show at most 10 normalized events. Overlap semantics retain an event already in progress; events that ended before the query instant are not part of the upcoming agenda.
- Send a depth-1 CalDAV `REPORT` with a `VEVENT` time-range filter and a matching `calendar-data` expansion range. Recurrence expansion remains the CalDAV server's responsibility; the application will not implement an RRULE recurrence engine.
- Request and parse only fields needed by the agenda: `DTSTART`, `DTEND`, `SUMMARY`, `LOCATION`, `STATUS`, `UID`, and `RECURRENCE-ID`. UID/resource identity may be used internally for deterministic deduplication but is never returned to the browser.
- Support all-day `DATE` values and UTC or `TZID` date-time values. Apply RFC defaults when `DTEND` is absent: one day for an all-day event and zero duration for a timed event. Omit cancelled, malformed, out-of-window, or unsupported entries without exposing their raw values.
- Format timed events in the dashboard's existing selected IANA timezone. Keep all-day dates as calendar dates so they do not shift to another day during timezone conversion.
- Refresh while the page is visible and retain a visibly marked stale snapshot after a transient refresh failure. Empty successful calendars are distinct from unconfigured and unavailable states.
- Keep the implementation dependency-free. Add focused, bounded XML and iCalendar parsing for the narrow response shape instead of introducing a general calendar package, build step, or runtime installation requirement.

## Implementation Plan

### 1. Add a bounded Baikal CalDAV client

- Create `src/caldav.js` with injectable request and clock seams for deterministic tests.
- Normalize connection input:
  - require an absolute `http://` or `https://` collection URL;
  - reject embedded URL credentials, query strings, fragments, and unsupported protocols;
  - preserve the full Baikal collection path and normalize it to one trailing slash;
  - require a trimmed username of at most 120 characters, reject `:` in the username because Basic authentication cannot represent it unambiguously, and accept a non-empty password of at most 2,000 characters for a new connection.
- Implement an HTTP(S) request helper that sends `REPORT`, `Depth: 1`, XML content type/accept headers, and a UTF-8 Basic authorization header. Enforce normal certificate and hostname verification, an 8-second timeout, a 2 MiB response limit, valid HTTP status/content type, no protocol upgrades, no credential-bearing cross-origin redirects, at most five same-origin redirects, and method/body preservation across accepted redirects.
- Generate a fixed CalDAV XML body with escaped UTC range values in both the `VEVENT` `time-range` filter and `calendar-data` `expand` element. Require a successful 207 Multi-Status response; classify authentication/authorization, unsupported report/expansion, malformed response, timeout, TLS, and temporary upstream failures into safe local errors.
- Parse the Multi-Status response with a small non-evaluating XML tokenizer that tracks namespace declarations and extracts only CalDAV `calendar-data` text. Reject declarations/DOCTYPE/external entities, malformed nesting, invalid entities, excessive element depth/count/text, and oversized input. Support normal escaped text and CDATA without interpreting markup from event data.
- Parse each extracted VCALENDAR using bounded RFC 5545 line unfolding and property parsing. Bound line length, component nesting, property count, calendar-object count, VEVENT count, and output string lengths; decode only standard iCalendar text escapes; ignore unknown properties and components.
- Normalize at most 500 candidate VEVENT instances into a browser-safe internal shape. Parse `DATE`, UTC date-time, numeric offsets if encountered, and named `TZID` wall times using validated `Intl` timezone conversion with explicit DST handling; reject unsupported/floating or impossible values rather than silently using the server's local timezone.
- Omit `STATUS:CANCELLED`, deduplicate expanded instances internally by bounded UID/recurrence identity, apply overlap checks defensively, sort by start/all-day/title, and return only the first 10 events as `{ title, start, end, allDay, location? }`. Use “Untitled event” for a missing summary and cap every public string.
- Add a short cache keyed by a non-reversible configuration fingerprint, deduplicate concurrent reads, support forced refresh, prevent obsolete requests from repopulating a cleared cache, and return stale cached events when a refresh fails. Expose `clearCache()` for reconnect/disconnect.

### 2. Persist CalDAV configuration securely

- Extend `src/db.js` with a singleton `caldav_config` table containing collection URL, username, AES-GCM password ciphertext/IV/tag, and timestamps.
- Add `getCalDav`, `saveCalDav`, and `removeCalDav` store methods. Map the encrypted password through the existing encrypted-secret object shape and never create or return a plaintext password column.
- Reuse the existing integration encryption key and AES-GCM helpers. Report missing/invalid encryption or decryption failure as a re-authentication state without leaking cryptographic details.
- Permit a blank password during reconnect only when both normalized collection URL and username are unchanged. Require a new password when either changes.
- Test the proposed credentials with a real bounded calendar query before encrypting and saving them. A failed initial connection saves nothing, and a failed reconnect preserves the last working configuration.

### 3. Add scoped Baikal private-CA and cache configuration

- Add `CALDAV_CACHE_SECONDS` with a 300-second default and optional `CALDAV_CA_FILE` to `src/config.js`, `.env.example`, and `docker-compose.yml`.
- Load the calendar CA during startup before accepting requests and pass it only to the CalDAV HTTPS client. Reuse/generalize the existing certificate-only PEM validation and scoped root-certificate augmentation rather than disabling TLS checks or setting `NODE_TLS_REJECT_UNAUTHORIZED`.
- Keep `LINKWARDEN_CA_FILE` scoped to Linkwarden and `NODE_EXTRA_CA_CERTS` behavior for Home Assistant unchanged. An unreadable, empty, invalid, or private-key-containing CalDAV bundle must stop startup with an error naming `CALDAV_CA_FILE`.
- Construct and inject the CalDAV client in `src/server.js`, preserving the side-effect-free server factory used by tests.

### 4. Add safe calendar API routes

- Inject `calDav` into `createDashboardServer()` and add a serialized configuration-mutation queue so overlapping connect/disconnect requests cannot restore deleted credentials.
- Add routes under the current private-address, allowed-Host, and same-origin mutation protections:
  - `GET /api/calendar`: return safe configuration status, encryption readiness, re-authentication state, collection URL, username, and update timestamp; never return a password;
  - `GET /api/calendar/events`: return `{ configured, events, stale }`, accept only `refresh=1` as a cache bypass, and avoid upstream work when unconfigured;
  - `PUT /api/calendar`: normalize credentials, retain a saved password only under the unchanged-identity rule, test the query, encrypt/save atomically, clear obsolete cache data, and return safe status plus initial events;
  - `DELETE /api/calendar`: delete the singleton configuration, clear cache state, and return 204.
- Use 400 for invalid submitted settings or rejected credentials/report support during connect, and 503 with a generic calendar-unavailable message for temporary failures of a saved configuration. Never return upstream XML/iCalendar, Authorization headers, passwords, UIDs, hrefs, parser details, or private server error text.
- Filter the public event object explicitly in `app.js` even though the client normalizes it, matching the defense-in-depth pattern used for Home Assistant identifiers.

### 5. Add the dashboard agenda and connection settings

- Add a `Calendar` section after weather in `public/dashboard.html` with a heading, status region, refresh action, and semantic upcoming-event list. Keep it independent so hiding or failing weather does not hide the calendar.
- Add browser-local `calendarVisible` and `calendarScale` preferences to `dashboard-helpers.js` and the Information/settings form, normalized to the existing boolean and 0.5-2 scale conventions.
- Add a server-backed Baikal connection section in the settings dialog with collection URL, username, password, connect, and disconnect controls. Prefill only safe URL/username metadata; use a password input with appropriate autocomplete; explain that blank retains the saved password only when URL and username are unchanged.
- Create `public/dashboard-calendar.js` as a small controller with injected fetch/timer/document-visibility seams. It should load status/events on startup, refresh every five minutes only while configured, visible, and enabled, deduplicate work, support explicit refresh, abort/discard stale requests after reconnect/disconnect/page disposal, and keep the last successful event list marked stale after transient failures.
- On connect, disable duplicate submissions and use the atomic PUT response to render immediately. Keep validation errors in the open dialog. On disconnect, require confirmation, delete server credentials, clear events/timers, and show the unconfigured state without affecting clock, weather, or photos.
- Render all titles and locations through `textContent`. Format timed starts/ends with `Intl.DateTimeFormat` in `settings.timezone`; format all-day `YYYY-MM-DD` values without UTC/local date drift. Show concise day/time ranges, distinguish all-day/current/upcoming events, omit empty locations, and provide explicit unconfigured, loading, empty, stale, and unavailable messages.
- Integrate calendar lifecycle with `apply()`, `visibilitychange`, `pagehide`, and persisted-page restoration without introducing duplicate intervals or allowing late responses to overwrite newer connection/settings state.

### 6. Style the agenda within the existing visual language

- Extend `public/dashboard.css` with a transparent calendar overlay, compact event rows, readable date/time/title/location hierarchy, and controls that retain sufficient contrast over photos.
- Honor overall position, calendar scale, narrow screens, long unbroken text, high browser-local scale, reduced motion, keyboard focus, and horizontal containment. Do not add decorative animation or an opaque generic card around the agenda.
- Keep the settings connection form usable in the existing modal at mobile widths and ensure status/action controls wrap rather than overflow.

### 7. Add automated coverage

- Add `test/caldav.test.js` for credential normalization, Basic auth, exact Baikal collection paths, REPORT headers/body/ranges, same-origin redirect preservation, cross-origin redirect rejection, timeout/status/content-type/size/TLS failures, caching, stale fallback, forced refresh, in-flight deduplication, and cache-generation races.
- Cover XML parsing with namespace-prefix variations, escaped/CDATA calendar data, multiple responses, malformed XML, DTD/entity attempts, excessive depth/count/size, and missing calendar-data.
- Cover iCalendar parsing with folded lines, text escaping, all-day and timed events, UTC/offset/TZID values, DST boundaries, absent end values, expanded recurring instances, overrides, cancellation, duplicates, malformed/unsupported dates, bounds, overlap filtering, deterministic ordering, and public field truncation.
- Extend database tests to prove the Baikal password is encrypted at rest, no plaintext password column exists, upsert/disconnect work, and other integration configuration remains unchanged.
- Add API integration tests with an injected CalDAV fake for unconfigured status, successful atomic connect, safe metadata/events, retained-password reconnect, URL/username-change password requirement, failed reconnect preservation, explicit refresh, stale/unavailable behavior, re-authentication state, disconnect, mutation ordering, and absence of passwords/UIDs/hrefs/raw payloads in responses.
- Extend dashboard tests for normalized visibility/scale settings, event date/time/all-day formatting helpers, controller refresh/visibility/race/disposal behavior, static markup and password attributes, safe DOM rendering, and responsive/transparent CSS assertions.
- Extend configuration/startup tests for the cache setting and scoped `CALDAV_CA_FILE`, including successful private-CA trust, rejection without trust, continued hostname verification, certificate-only validation, and unchanged Linkwarden/Home Assistant trust scope.

### 8. Documentation, release, and implementation record

- Update `README.md` to document the `/dashboard` agenda, exact Baikal collection URL requirement, Basic-auth account guidance, 14-day/10-event/read-only/recurrence-expansion scope, encrypted password behavior, refresh/stale states, disconnect semantics, and trusted-LAN deployment boundary.
- Document `CALDAV_CACHE_SECONDS` and scoped `CALDAV_CA_FILE` setup with a Baikal private CA. State that hostname/expiry/chain verification remains active and that plain HTTP exposes Basic credentials on the LAN.
- Update the project description and backup notes to include encrypted CalDAV configuration.
- Bump `package.json` from `0.12.3` to `0.13.0` for the new optional integration and dashboard feature.
- Write `tasks/21-dashboard-caldav-calendar/3-implemented.md` with actual protocol decisions, changed files, verification evidence, real-Baikal/browser availability, and any departures from this plan.

## Verification

Run from the repository root:

```bash
node --test test/caldav.test.js
node --test test/dashboard.test.js
npm test
npm run check
git diff --check
```

Also verify:

1. Connect to a Baikal calendar collection containing empty, timed, all-day, multi-day, recurring, overridden, cancelled, DST-boundary, long-title, and location-bearing events; confirm the next 14 days are ordered and capped at 10.
2. Confirm failed credentials, a principal/home URL instead of a collection URL, unsupported expansion, malformed calendar data, timeout, and outage produce safe actionable states while a failed reconnect preserves working credentials.
3. Inspect API responses, process output, static assets, and SQLite values to confirm the password, Authorization value, UID, href, and raw calendar data are absent; verify the password decrypts only through the configured integration key.
4. Verify a private-CA Baikal connection succeeds only with `CALDAV_CA_FILE`, still rejects hostname mismatch/expired certificates, and does not change Linkwarden, Home Assistant, or Open-Meteo trust.
5. Verify calendar show/hide and scale settings, manual and timed refresh, stale fallback, reconnect/disconnect races, hidden-page pause/resume, timezone changes, all-day date stability, empty calendar, narrow screens, high scale, long text, keyboard operation, and screen-reader status/list output.
6. Confirm clock, photos, weather, Home Assistant, Linkwarden, and Wake-on-LAN continue to work when the calendar is unconfigured or unavailable.
7. If Docker is available, run `docker compose config` and start the service with the scoped CA mounted under `./certs`. Record Docker, browser, or real-Baikal checks as unavailable rather than claiming they passed.

## Acceptance Criteria

- A LAN user can connect, update, and disconnect one exact Baikal CalDAV collection from `/dashboard` using Basic authentication without exposing or storing the password in plaintext.
- The dashboard displays at most 10 safe upcoming events from the next 14 days, including all-day, multi-day, timezone-aware, and server-expanded recurring instances, in the selected dashboard timezone.
- The CalDAV client uses a bounded depth-1 `REPORT`, enforces timeout/response/parser limits, rejects unsafe redirects and XML constructs, verifies TLS normally, and optionally trusts only the configured calendar CA bundle.
- Configuration is saved only after a successful query; failed reconnects preserve the last working configuration, and mutation/cache races cannot restore stale credentials or events.
- Empty, loading, stale, unavailable, re-authentication, and unconfigured states are distinct and accessible; calendar failures do not affect other dashboard features.
- API responses and rendered DOM contain no password, Basic authorization value, raw iCalendar/XML, event UID, or CalDAV resource href.
- No package dependency, build step, or install requirement is introduced, and all existing plus new automated checks pass.
- Documentation, environment/Compose examples, implementation record, and version `0.13.0` match the delivered behavior.

## Planning Verification

- Inspected task numbering, project/runtime configuration, encrypted integration storage, HTTP/private-CA clients, API safety boundaries, dashboard settings/controller lifecycles, tests, deployment files, and README conventions.
- Reviewed RFC 4791 calendar-query, time-range, and calendar-data expansion requirements and incorporated the user's Baikal/self-hosted clarification.
- This planning task adds only `tasks/21-dashboard-caldav-calendar/1-plan.md`; implementation code remains unchanged.
