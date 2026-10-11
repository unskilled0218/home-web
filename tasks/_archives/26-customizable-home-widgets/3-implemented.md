# Task 26: Customizable Home Widgets Implementation

## Result

Implemented server-persisted home display preferences and independently editable desktop/mobile widget layouts, with time, weather, calendar, Wake-on-LAN, bookmarks, and selected Home Assistant devices/readings. This record was created before implementation changes and completed after verification.

## Changes

- Added `public/home-layout.js` as the shared pure schema, defaults, geometry, collision, and selection-normalization module; `src/home-settings.js` exposes it to the server with a route-specific 64 KiB request limit.
- Added an idempotent singleton SQLite `home_settings` table and store methods in `src/db.js`. Defaults are created once, both layouts and shared preferences persist together, and atomic revision-checked updates protect concurrent clients.
- Added `GET /api/home/settings` and `PUT /api/home/settings` in `src/app.js` with existing LAN/Host/Origin checks, validation, canonical responses, HTTP 409 conflicts, and safe errors for unreadable settings. Existing settings are not replaced after load errors.
- Added `public/home-settings.js` for initial loading, acknowledged/draft state, save/retry/cancel, conflicts, deduplicated loads, bounded requests, one visible 30-second synchronization timer, and focus/resume refresh.
- Reworked the home composition in `public/app.js`, `public/index.html`, and `public/styles.css` with a six-widget catalog, shared Settings, empty states, separate desktop/mobile layouts, Edit widgets, Save/Cancel, numeric position/size controls, and a mobile-friendly grid.
- Added `public/home-widgets.js` for stable widget DOM ownership, move/resize Pointer Events, grid previews and collision displacement, cancellation and capture release, keyboard equivalents, focus preservation, and data-owner reconciliation independent of geometry edits.
- Extracted existing integration behavior into `public/home-integrations.js`, retaining Wake-on-LAN CRUD/bulk dispatch, Linkwarden browsing/refresh/session recovery, and Home Assistant controls. Integration connection/disconnection remains available in Settings when widgets are absent; obsolete loads are invalidated on removal and page suspension.
- Added `public/home-information.js` to reuse existing clock/forecast/event formatting and weather/calendar controllers with home-scoped views, location/units preferences, calendar connection management, stale states, and active/visible lifecycles. The photo dashboard remains independently accessible.
- Retained internal measurement entity IDs in `src/home-assistant.js` and added domain-separated, server-scoped opaque device/reading selection IDs in public responses. These survive renames, ordering changes, and token rotation; control actions still require the existing server-issued expiring control tokens.
- Added searchable Home Assistant device/reading selection, stable matching, unavailable placeholders, and bounds of 50 selected devices, 100 readings per device, and 500 readings total.
- Updated `README.md` with shared persistence, both layouts, editing, synchronization/conflicts, integration settings, and the separate browser-local photo dashboard. Bumped `package.json` from `0.15.2` to `0.16.0`.

## Final Behavior

- Desktop uses 12 columns at viewport widths of at least 768px; mobile uses an independent four-column layout below that breakpoint. Each layout has independent membership, positions, widths, and heights. Display preferences and selected Home Assistant devices/readings are shared.
- Removing a widget never deletes an integration, machine, the other layout's widget, or shared widget settings. Each layout can be empty.
- Drafts survive breakpoint changes; active gestures cancel before the grid changes. Save commits draft changes together. Cancel restores acknowledged state and reloads newer server settings. Failed or conflicting saves retain the draft without silently overwriting another device's changes.
- Home settings have no localStorage dependency. SQLite backup/restore includes both layouts and preferences; the initial timezone is UTC. `/dashboard` keeps its existing browser-local preferences and photo behavior.
- Calendar remains automatic-only with its five-minute timer, immediate resume, stale fallback, and authentication/authorization handling. Geometry-only edits do not restart data owners. Visibility suspension and back/forward restoration preserve one owner per controller.

## Verification

Passed:

```text
node --test test/home-layout.test.js test/home-settings.test.js test/home-settings-api.test.js test/home-widgets.test.js test/home-assistant.test.js test/home-assistant-api.test.js test/dashboard-calendar.test.js test/dashboard.test.js
50 tests passed at the focused checkpoint; additional selection/lifecycle coverage was then included in the full run.

npm test
144 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

- New tests cover layout independence/bounds/collisions, empty layouts, malformed envelopes, shared API round trips, existing-database schema creation, restart persistence, corrupted-record preservation, access checks, oversized requests, concurrent saves, drafts/conflicts, obsolete load suppression, timer ownership, gesture preview/commit/cancel, keyboard resize, non-handle event isolation, owner reconciliation, missing selections, and integration removal during pending requests.
- Extended Home Assistant API tests prove selection identity stability across renaming, reordering, and token rotation, server namespace separation, and rejection of selection IDs as action tokens. Updated exact normalization/TLS expectations for internal measurement identity and home markup assertions for the new toolbar.
- Static HTTP coverage includes all new browser modules and the existing photo dashboard aliases.
- No browser executable or browser-automation runtime was available. Pointer/keyboard handlers were exercised through injected DOM/event geometry surfaces, and separate HTTP clients exercised sharing/conflicts; these are not claimed as visual, real-touch, or multi-device browser checks. Live CalDAV, Home Assistant, Linkwarden, NFS, and physical Wake-on-LAN checks were not performed.

## Implementation Notes

- Retained singleton widget DOM roots while hidden rather than destroying/recreating integration markup. Lifecycle reconciliation still pauses information widgets and invalidates obsolete integration loads, while preserving form/search/collection state and avoiding duplicate listeners.
- Settings uses explicit Apply controls to stage display/selection changes, followed by Save shared changes; the catalog saves immediately when there is no existing edit draft. The README documents this interaction.
