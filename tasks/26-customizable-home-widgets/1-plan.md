# Task 26: Customizable Home Widget Dashboard

## Objective

Turn the home page into a dashboard with configurable time, weather, calendar, Wake-on-LAN, bookmarks, and selected Home Assistant device/information widgets. Provide a Settings widget catalog, an Edit widgets button, drag-and-drop placement, and visible resize dots.

## Request and Planning Assumptions

- Source: `~/workdir/command.md`, requesting home as a more customizable dashboard, widgets added from Settings, a home-widget edit button, drag and drop, a dot to edit size, and the six widget types listed above.
- Target `/` and its existing index page. Keep `/dashboard` and `/dashboard/` available as the existing photo dashboard with its saved preferences and navigation.
- Start with one instance of each widget type; the Home Assistant widget supports multiple selected devices and readings. The catalog indicates already-added widgets instead of creating duplicate integration panels.
- Use a responsive, grid-snapped layout with configurable width and height rather than arbitrary overlapping pixel coordinates. Interpret the resize dot as a bottom-right drag handle with a generous pointer target.
- Save home layout and display preferences on the server so every device uses the same configuration. Maintain two independently saved layouts, desktop and mobile; choose desktop at viewport widths of 768px or greater and mobile below 768px.
- Widget membership, geometry, and order are independent per layout. Display preferences and widget-specific configuration, including Home Assistant selections, are shared across both layouts. Integration credentials and Wake-on-LAN devices remain server-managed.
- Home uses dashboard-like time/weather/calendar presentation in readable cards. Existing NFS photo backgrounds remain a feature of `/dashboard`; a new home background editor is outside this request.
- On first visit show time, weather, calendar, bookmarks, Home Assistant, and Wake-on-LAN in a useful default arrangement. Unconfigured integrations show setup prompts; Home Assistant initially asks the user to select devices rather than automatically displaying every device.

## Inspected Context

- The project is version `0.15.2`, uses native browser modules with no build step or runtime package dependencies, and runs tests with `node --test`.
- `public/index.html`, `public/styles.css`, and `public/app.js` implement the current stacked bookmarks, Home Assistant, and Wake-on-LAN home page, including CRUD, connection dialogs, collection navigation, and device controls.
- `public/app.js` captures fixed global DOM IDs and loads all three integrations at startup. It cannot safely be imported as a widget renderer or mounted repeatedly without separating its startup and lifecycle responsibilities.
- `public/dashboard.js` similarly owns fixed DOM IDs, rendering, settings, and page lifecycle. Its weather and calendar data controllers are already separate in `public/dashboard-weather.js` and `public/dashboard-calendar.js`.
- `public/dashboard-helpers.js` owns normalized browser preferences under `dashboard.preferences.v1`, clock formatting, weather icons, and forecast sampling. The latest intended presentation includes seven hourly samples and compact temperature ranges.
- Calendar refresh already loads immediately, refreshes every five minutes while visible/enabled, pauses when inactive, and suppresses retries on authentication/authorization failures. Reuse this controller and preserve the absence of a manual calendar refresh button.
- Home Assistant normalization in `src/home-assistant.js` retains internal device and control entity IDs, but measurements currently lose their entity identity. `publicHomeAssistantDevices()` in `src/app.js` strips device IDs and issues short-lived control tokens. Names, array positions, and control tokens cannot reliably identify saved selections.
- Linkwarden collection tokens also expire. Existing collection browsing is session-scoped and recovers by requesting a new tree; the widget must preserve that behavior.
- Tests cover integration APIs, controller lifecycles, rendering helpers, and static home/dashboard assets. Some static assertions intentionally encode the old stacked layout and will need targeted changes for the new home design.
- `src/db.js` owns the SQLite schema and store methods in `data/wol.db`. Add one shared home-configuration record there; the existing application has no per-user accounts. New configuration routes belong in `src/app.js` under the existing API access checks.

## Behavioral Design

### Home shell and settings

- Replace the fixed section stack with a labeled widget grid and a toolbar containing Settings, Edit widgets, and the existing Photo dashboard link.
- Settings contains an Add widget catalog for all six types, time/timezone and weather/location preferences, Home Assistant device/reading selection, and access to existing integration connection dialogs even when their widget is removed.
- Adding a widget places it in the first available space in the active layout only. Removing it affects only that layout; it does not remove the widget from the other layout, discard shared widget settings, disconnect integrations, or delete saved machines. An empty desktop or mobile layout is valid and shows an Add widgets prompt.
- Edit widgets identifies the active Desktop or Mobile layout and enters a draft with move handles, resize dots, Remove, Save layout, and Cancel. Settings additions/removals join that draft when editing; outside edit mode they save to the server immediately. Cancel and Escape restore the last acknowledged configuration. Connection changes and Wake-on-LAN CRUD are independent of layout drafts.
- Crossing the breakpoint while editing cancels any active pointer gesture but retains separate in-memory drafts for both layouts. Save writes all draft changes atomically; Cancel discards them. In normal mode, switching viewport uses the already-saved corresponding layout and never derives or overwrites one from the other.
- Normal mode keeps resize/move controls hidden and permits ordinary links, scrolling, and device actions. Layout gestures start only from dedicated handles and never trigger Wake or Home Assistant actions.
- Retain the existing device CRUD, bulk Wake, collection tree, connection/reconnection/disconnection, and Home Assistant control workflows in their widgets or Settings. Open only one modal dialog at a time and restore focus to its launcher when closed.

### Layout and persistence

- Add `public/home-layout.js` for pure layout normalization, default placement, and collision resolution, and `public/home-settings.js` for server loading, saving, revision tracking, and synchronization. Home has no localStorage source of truth; `/dashboard` retains its separate `dashboard.preferences.v1` behavior.
- Persist a bounded envelope `{ version: 1, revision, layouts: { desktop, mobile }, preferences, widgetSettings }`. Each layout contains at most six entries with an allowlisted widget type, stable singleton ID, and integer `x`, `y`, `w`, `h`. Keep per-type configuration in shared `widgetSettings`, not duplicated in geometry entries. Reject unknown types, duplicate IDs, invalid shapes, and unsupported versions at the API boundary; normalize valid bounded geometry deterministically.
- Use a 12-column desktop grid, fixed 64px row units, and 16px gaps. Define minimum/default spans per widget in one registry; start time at 4×3, weather at 8×6, calendar at 4×6, and each integration widget at 6×6. Bound heights to 3–24 rows and stored row positions to a finite range, compacting invalid or excessive gaps during normalization.
- Clamp widths/positions to the grid and enforce widget-specific minimums. Place the edited widget first, then relocate colliding widgets downward in stable order to the first available cells. Use the same deterministic placement algorithm for load repair, additions, pointer edits, and keyboard edits.
- Use a separate four-column mobile grid with the same row/gap units, independent positions and sizes, and mobile-specific minimum widths. Default widgets to full mobile width, allow time at two columns, and keep dense widgets at four columns. Support height resizing on all mobile widgets and width resizing where minimum spans permit it. Use scrollable card bodies rather than replacing saved mobile heights with natural height.
- Initialize both layouts once from explicit defaults, with mobile widgets stacked in a useful order; subsequent desktop changes never regenerate mobile and vice versa. Enforce row/height bounds and collision rules independently for each grid. Provide accessible move and size controls on mobile as well as touch handles.
- Persist completed Save operations and explicit Settings submissions, not every pointer move. Retain drafts on failed writes and show an unsaved/retry state. Initial load failure shows a retryable error rather than saving defaults over an unknown server configuration; later failures keep the last acknowledged configuration visible.
- Initialize missing server state with deterministic shared defaults, including an explicit timezone of UTC until changed in Settings. Do not seed server settings from an arbitrary visiting browser's localStorage or timezone. Widget membership in the active layout determines visibility. Distinguish a missing record from malformed/unsupported stored data; report the latter without silently replacing it.
- Store only presentation settings and stable selection keys. Do not persist credentials, control/collection tokens, calendar snapshots, or integration response bodies.
- Add `GET /api/home/settings` and `PUT /api/home/settings`. GET returns the complete canonical configuration and revision; PUT requires the revision read by the client and returns the updated canonical configuration. Use an atomic SQLite compare-and-update with revision increment; return HTTP 409 on stale revisions without changing either saved layout or preferences. Preserve the user's draft and offer reload/reapply rather than automatically overwriting newer changes.
- Refresh shared settings on initial load, visible-tab focus/resume, and every 30 seconds while visible; own one synchronization timer. Apply newer server revisions when no local edits are pending. During editing retain drafts and mark newer remote state as a conflict. Pause synchronization while hidden/disposed and deduplicate concurrent loads. This bounds propagation between already-open devices without adding real-time infrastructure.
- Bound total serialized settings to 64 KiB using a route-specific `readJson` limit and cap Home Assistant selection counts/strings to fit it; leave unrelated API limits unchanged. Validate server-side before writing and enforce the existing trusted-LAN, Host, and mutation-Origin checks.

### Interaction and lifecycle

- Add `public/home-widgets.js` for the widget registry, mount/unmount coordination, edit state, and Pointer Events handling. Keep geometry logic in `home-layout.js` independent of the DOM.
- Use pointer capture for mouse/touch/pen move and resize, snap previews to grid cells, and release capture on completion, cancellation, Escape, resize, or teardown. Restrict `touch-action: none` to handles so widget content and the page remain scrollable.
- Add accessible move and resize labels, visible focus, keyboard arrow movement/resizing, and explicit position/size controls in Settings. Announce completed moves and sizes through a status region; preserve logical focus and reading order after reordering.
- Preserve widget DOM/controller instances when only geometry changes. Reconcile additions/removals by ID rather than rebuilding the entire home tree on every pointer move or data response.
- Clock runs only while mounted and the page is visible. Weather/calendar reuse their existing active/inactive semantics. Removing them stops timers and aborts obsolete requests; re-adding starts exactly one active owner.
- Existing integration requests load on mount, explicit refresh, connection changes, and relevant actions; do not add an unrelated polling cadence. Opening a Settings picker may fetch its integration while its widget is absent.
- Invalidate late integration responses on removal, connection replacement, or disconnect. On pagehide stop active work; on persisted pageshow restore usable owners without duplicate listeners or timers. Distinguish suspension from permanent disposal.

## Implementation Steps

### 1. Build server persistence, the dual-layout model, and shell

- Implement the versioned dual-layout envelope, defaults, bounded grid operations, and edit draft/save/cancel in `public/home-layout.js`. Share the pure schema/default/geometry module with server-side validation through a thin `src/home-settings.js` boundary so rules cannot drift; keep it free of browser globals and secrets.
- Add an idempotent singleton `home_settings` table in `src/db.js` with canonical JSON, revision, and update timestamp. Initialize defaults safely for concurrent first visits and implement atomic revision-checked saves. Existing installations require no manual database reset, and saved settings survive process restarts and normal database backup/restore.
- Implement the GET/PUT routes in `src/app.js` with validation, payload bounds, conflict handling, and canonical responses. Add `public/home-settings.js` with injected fetch/timers for initial loading, acknowledged state, save errors, conflicts, and visible-page synchronization.
- Render the shell while configuration loads, then mount widgets for the active saved layout. Wire explicit shared-preference saves through the same revision protocol; serialize this browser's mutations to avoid racing layout and display-preference writes.
- Update `public/index.html` and `public/styles.css` with the home toolbar, widget grid, catalog/preferences dialog, edit controls, resize dots, and empty state. Scope new card/forecast styles so `/dashboard` keeps its existing layout.
- Keep stable IDs for retained singleton integration contents and existing dialogs where practical. Remove obsolete stacked-section spacing and update old order-specific tests to match the new default arrangement.

### 2. Adapt existing home integrations to widget ownership

- Refactor `public/app.js` into an explicit home composition entry point. Extract the existing integration view/controller responsibilities into `public/home-integrations.js` with supplied roots and lifecycle methods, retaining `public/app-helpers.js` behavior.
- Retain a single session owner per integration, shared between its widget and Settings. Distinguish removing a widget from disconnecting its service; a pending server mutation must still report its outcome without publishing into detached widget DOM.
- Preserve Wake-on-LAN selection/error behavior, Linkwarden collection selection and expiration recovery, and Home Assistant pending-action/request-generation checks. Do not use expiring tokens as persisted widget configuration.
- Wire all connection controls through Settings and ensure a removed integration widget can still be configured and re-added successfully.

### 3. Add reusable time, weather, and calendar views

- Add `public/home-information.js` with root-scoped time/weather/calendar views and home settings wiring. Reuse existing formatting helpers and controller factories rather than importing either existing page entry module.
- Provide clock timezone/date/hour format/seconds settings, weather location search and units, and calendar connection management on home. Scope names/IDs to avoid collisions with the home integration forms.
- Reuse the current condition icons, hourly/daily forecast data, compact temperatures, event timezone handling, all-day formatting, stale labels, and setup/error states. Use card-width-responsive forecast styling rather than copying the photo dashboard's global 70% width rule.
- Keep calendar automatic-only and preserve five-minute refresh, hidden/unmounted pause, immediate resume, stale fallback, and 401/403 clearing. Retain hourly weather refresh and independent forecast/air-quality failure behavior.

### 4. Support persistent Home Assistant selections

- Retain measurement entity IDs internally during normalization in `src/home-assistant.js`. Add opaque stable `selectionId` fields for devices and readings to public device responses in `src/app.js`.
- Derive selection IDs deterministically from a domain-separated tuple of normalized Home Assistant base URL, registry device ID, and measurement entity ID where applicable, using SHA-256. Exclude access tokens so token rotation retains selections; names and areas must not affect identity. A changed server URL yields a distinct namespace.
- Keep raw registry/entity IDs internal and use existing expiring `controlToken` values exclusively for actions. Selection IDs are presentation identifiers and must not be accepted by the controls endpoint as authority.
- In Settings, fetch the device list and offer searchable device checkboxes with nested reading choices. Persist selected device IDs and reading IDs; show selected devices with their current supported controls and only selected readings. Default newly selected devices to all currently available readings, storing the explicit selection; future new readings require selection.
- Render missing devices/readings as unavailable selections that the user can remove, without silently selecting a same-named replacement. Empty selection presents a Settings prompt. Disconnect clears live values and controls while retaining layout and selection preferences for reconnecting to the same server.
- Keep existing numeric measurement bounds, unavailable states, service allowlists, credential isolation, and opaque control-token expiration behavior.

### 5. Complete drag, resize, and responsive editing

- Wire the pure grid model to move handles and bottom-right resize dots with visual previews, collision displacement, cancel/commit semantics, and keyboard equivalents.
- Keep dense widget content inside scrollable card bodies at the independently saved desktop/mobile heights, with accessible headers/status and controls outside clipped regions. Bind gestures to the active grid's column count/minimum spans and cancel the current gesture on breakpoint changes before displaying the other draft or saved layout.
- Ensure moving/resizing does not recreate active forms, reset searches/collection selection, duplicate handlers, or dispatch device actions. Save/Cancel must restore all displaced widget positions as one layout operation.

### 6. Documentation and release record

- Document home widget setup, catalog, edit/save/cancel, resize handles, independently edited desktop/mobile layouts, the 768px breakpoint, shared server display preferences, selected Home Assistant readings, and access to integration settings after widget removal in `README.md`.
- Explain cross-device update timing, failed saves/conflicts, and inclusion of home settings in the SQLite backup. Describe the separate browser-local `/dashboard` photo preferences accurately. Bump `package.json` from `0.15.2` to `0.16.0` for the new home capability.
- Create `tasks/26-customizable-home-widgets/3-implemented.md` before changing implementation code, then maintain it with final behavior, changed files, verification results, and departures before the implementation commit.

## Verification Plan

- Add `test/home-layout.test.js` covering invalid envelopes, unsupported versions, independently empty layouts, duplicates, bounds, deterministic collision handling in both grid sizes, per-layout add/remove/re-add, and save/cancel. Prove desktop edits never alter mobile geometry/membership and mobile edits never alter desktop; shared preferences/settings remain shared.
- Add `test/home-settings-api.test.js` covering first-run defaults, schema creation on existing databases, restart persistence, cross-client reads, canonical round trips of both layouts and shared preferences, invalid/oversized payloads, existing access checks, stale-revision 409 responses, and atomicity under competing saves.
- Add `test/home-settings.test.js` covering loading/saving failures, retained drafts, revision conflicts, serialized mutations, cross-client update adoption, remote changes during editing, one visible synchronization timer, and hidden/resume behavior. No home preference may depend on localStorage availability.
- Add `test/home-widgets.test.js` using injected event/scheduler/controller seams for gesture commit/cancel, keyboard equivalence, non-handle action isolation, removal during requests, no duplicate owners during geometry edits, hidden/resume, and page restoration. Exercise behavior rather than asserting source text alone.
- Extend `test/home-assistant.test.js` and `test/home-assistant-api.test.js` for stable device/reading IDs across rename/reorder/token rotation, distinct server namespaces, missing selections, and continued rejection of selection IDs as control tokens. Adjust exact response expectations for additive public fields and retained internal measurement identity.
- Extend home server/static checks in `test/app-server.test.js`, `test/linkwarden-server.test.js`, and `test/dashboard.test.js` for the catalog/shell/assets, reachable integration settings, and continued photo dashboard aliases. Update only assertions invalidated by the planned UI/API changes.
- Retain and run calendar/weather lifecycle and integration regression tests. Run `node --test test/home-layout.test.js test/home-settings.test.js test/home-settings-api.test.js test/home-widgets.test.js test/home-assistant.test.js test/home-assistant-api.test.js test/dashboard-calendar.test.js test/dashboard.test.js`, then `npm test`, `npm run check`, and `git diff --check`.
- In two separate browsers/devices, save a desktop layout and shared preferences and confirm another desktop receives them; save a different mobile layout and confirm another mobile receives that arrangement while desktop stays unchanged. Verify persistence after server restart, 320px/mobile/desktop breakpoint transitions, draft preservation across a breakpoint, and no dependency on browser storage.
- Add/remove each widget per layout, move and resize with mouse/touch/keyboard, exercise collision displacement, save/reload, cancel changes, and empty one layout without emptying the other. Test server unavailability and concurrent edits: failed/conflicting saves retain drafts and cannot silently erase another device's changes.
- Verify settings access after removal, Wake-on-LAN CRUD/bulk actions, bookmarks collection navigation, Home Assistant selection persistence after rename/reload and control refresh, missing readings, calendar automatic refresh, and weather location changes. Use fixtures or a configured local service; record unavailable live checks honestly.
- Verify tab hide/resume and browser back/forward restore do not multiply requests or timers, layout editing never triggers actions, and `/dashboard` still loads existing preferences and photo/calendar/weather functionality.

## Acceptance Criteria

- `/` is a usable widget dashboard with all six requested widget types available from Settings.
- Edit widgets enables drag-and-drop and visible resize dots; pointer and keyboard edits are bounded, nonoverlapping, cancelable, and persistent after saving.
- Home layout and display preferences are stored in SQLite and shared across devices, surviving browser changes and server restarts. Desktop and mobile each have independently persisted widget membership, positions, and sizes; the active layout follows the viewport breakpoint without rewriting the other layout.
- Display preferences and Home Assistant selections are shared across both layouts. Already-open visible clients adopt saved remote changes within the synchronization interval or on focus/resume, while concurrent edits are protected by revision conflicts.
- Widget removal does not delete integration configuration or devices, and the home page remains configurable with zero widgets.
- Home Assistant shows chosen devices and readings using stable identities across refreshes and renames; controls continue using current server-issued tokens.
- Time, weather, and calendar work on home with correct settings and lifecycle behavior, including automatic-only calendar refresh.
- Existing Wake-on-LAN, bookmarks, Home Assistant management, and `/dashboard` workflows remain usable.
- Both layout sizes, unavailable integrations, invalid server settings, load/save failures, concurrent edits, and late responses have explicit tested behavior.
- README, version, implementation record, automated checks, and browser-verification evidence match the delivered feature.

## Planning Verification

- Read the shared workflow conventions, current request, and existing task directory before choosing task number 26; inspected home/dashboard markup, entry modules, helpers, controllers, server response mapping, Home Assistant identity normalization, tests, documentation, and package metadata.
- This planning task creates only `tasks/26-customizable-home-widgets/1-plan.md`. Implementation and test changes belong to the subsequent implementation task.
- Updated at the user's request to replace browser-local home persistence and derived mobile projection with server-shared preferences and two independent saved layouts. Inspected `src/db.js` to ground the SQLite persistence and revision-checking work; this revision changes only the plan.
