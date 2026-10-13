# implemented

## Changes

- Added the middle dashboard column with Home Assistant in the upper half and Wake-on-LAN in the lower half. Desktop lists scroll independently, unchanged snapshots retain scroll position, and layouts at 1000px or narrower stack information, Home Assistant, Wake-on-LAN, and bookmarks. The existing 600px mobile preference breakpoint stays separate. Fullscreen bookmark hiding retains both device sections.
- Added Home Assistant device selection to Settings and the existing globally stored, revision-aware preferences. Selections use the existing origin-scoped opaque device IDs, default to empty, and allow up to 256 unique devices. Missing selections remain removable without exposing raw IDs. Polling preserves dirty drafts and focus; unrelated preference saves retain selections. Duplicate display labels receive a numbered distinction.
- Added one shared previous-schema decoder for database records and shared browser caches. Valid previous records gain only empty selections without read-time writes, changed revisions, or lost old values. Corrupt records and incomplete API writes remain rejected. Current selections canonicalize ordering so equivalent saves do not increment revisions.
- Added opaque Home Assistant configuration identity and server-side stale-read guards. Display-only `GET /api/home-assistant/devices?controls=0` snapshots do not issue or evict action tokens. Default GET and connect responses retain their control behavior. Connection changes clear old readings while same-origin credential changes preserve saved selection identities.
- Shared Home Assistant status and Wake-on-LAN controllers between Settings and dashboard, with one visible-page polling owner. Settings receives injected controllers and owns only form/session behavior, listeners, and subscriptions; closing it does not stop dashboard polling. Status/device-list polls run independently every five seconds. Home Assistant snapshot reads run every 30 seconds only when selected devices or the picker need them, with deadlines, generation guards, strict validation, and an 8 MiB response limit.
- Rendered selected Home Assistant names and read-only numeric sensor snapshots with exact values/units, Unknown/Unavailable states, disabled/no-readings messages, and missing/stale/source-change feedback. Snapshot fetch time is distinguished from sensor observation time. Credentials, raw device/entity IDs, and control tokens are not stored in preference caches or display-controller state.
- Added name-and-Wake-only dashboard rows using the existing wake API. Requests require explicit activation, track pending state per device, never retry automatically, and preserve server cooldown/delivery/audit behavior. Separate section feedback handles packet dispatch, cooldown, removal, failures, and uncertain outcomes. Late results cannot overwrite a newer action or recreate a removed row.
- Added unit/API and real-server browser coverage for schema compatibility, scoped selection identity, token-store isolation, request ownership, polling/lifecycle, stale/malformed/oversize data, Wake behavior, persistence/restart, multi-browser conflicts, keyboard access, long lists, narrow/short screens, and fullscreen. Browser wake tests use an injected fake executor and send no UDP packets.
- Updated README and dashboard, Home Assistant, and Wake-on-LAN documentation. Bumped `package.json` and `package-lock.json` from `0.17.10` to `0.17.11`, following the existing patch-version task convention. No new dependencies, release publication, or `todo.md` changes.

## Verification

- `npm run check`: passed.
- `for file in src/*.js public/*.js; do node --check "$file" || exit 1; done`: passed; checks every source/browser module individually.
- `npm test`: passed with 248 tests before the final missing-selection refresh regression was added. Final `npm test -- --test-reporter=dot`: all 249 tests passed.
- `PLAYWRIGHT_PORT=43214 npm run test:browser`: 81 browser tests passed, including the existing Firefox/Chromium shared-preference scenario and the injected-controller disposal test.
- `PLAYWRIGHT_PORT=43216 npx playwright test e2e/dashboard-devices.spec.js --browser=chromium`: all 12 new browser cases passed again after the final picker-loop, disposed-owner guard, and missing-selection refresh changes.
- `git diff --check`: passed.

## Environment And Decisions

- The default browser-test port 3210 was already occupied. Verification used the existing `PLAYWRIGHT_PORT` override instead of stopping the unrelated listener. No system packages were installed.
- One unit-suite run concurrent with browser verification encountered `ECONNRESET` in the Linkwarden integration test. The immediate standalone full-suite rerun passed all 249 tests. No unrelated Linkwarden implementation was changed.
- Existing assertions tied to `display: contents`, a two-column layout at 601px, or dialog-only polling were updated to assert the planned stacked/device-column/shared-polling behavior. Bookmark content, disclosure, profile selection, and unrelated integration ownership checks remain covered.
- Sensor values are numeric strings in the existing API. The display decoder validates their finite numeric meaning but preserves the supplied string exactly instead of coercing or rounding it.
- The coordinator, read-only snapshot reader, picker, and dashboard view are separate native browser modules with explicit ownership. The view module was added to keep DOM rendering out of the network coordinator. No private test-only controller lifecycle was retained.
