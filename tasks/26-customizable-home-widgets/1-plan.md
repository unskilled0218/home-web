# Task 26: Customizable Home Widget Dashboard

## Objective

Turn the home page into a dashboard with configurable time, weather, calendar, Wake-on-LAN, bookmarks, and selected Home Assistant device/information widgets. Provide a Settings widget catalog, an Edit widgets button, drag-and-drop placement, and visible resize dots.

## Request and Planning Assumptions

- Source: `~/workdir/command.md`, requesting home as a more customizable dashboard, widgets added from Settings, a home-widget edit button, drag and drop, a dot to edit size, and the six widget types listed above.
- Target `/` and its existing index page. Keep `/dashboard` and `/dashboard/` available as the existing photo dashboard with its saved preferences and navigation.
- Start with one instance of each widget type; the Home Assistant widget supports multiple selected devices and readings. The catalog indicates already-added widgets instead of creating duplicate integration panels.
- Use a responsive, grid-snapped layout with configurable width and height rather than arbitrary overlapping pixel coordinates. Interpret the resize dot as a bottom-right drag handle with a generous pointer target.
- Save home layout and display preferences per browser, matching the existing dashboard storage model. Integration credentials and Wake-on-LAN devices remain server-managed.
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

## Behavioral Design

### Home shell and settings

- Replace the fixed section stack with a labeled widget grid and a toolbar containing Settings, Edit widgets, and the existing Photo dashboard link.
- Settings contains an Add widget catalog for all six types, time/timezone and weather/location preferences, Home Assistant device/reading selection, and access to existing integration connection dialogs even when their widget is removed.
- Adding a widget places it in the first available grid space. Removing a widget changes layout only; it does not disconnect integrations or delete saved machines. An empty layout is valid and shows an Add widgets prompt.
- Edit widgets enters a draft layout with move handles, resize dots, Remove, Save layout, and Cancel. Settings additions/removals join that draft when editing; outside edit mode they persist immediately. Cancel and Escape restore the saved layout. Connection changes and Wake-on-LAN CRUD are independent of layout drafts.
- Normal mode keeps resize/move controls hidden and permits ordinary links, scrolling, and device actions. Layout gestures start only from dedicated handles and never trigger Wake or Home Assistant actions.
- Retain the existing device CRUD, bulk Wake, collection tree, connection/reconnection/disconnection, and Home Assistant control workflows in their widgets or Settings. Open only one modal dialog at a time and restore focus to its launcher when closed.

### Layout and persistence

- Add `public/home-layout.js` for pure layout normalization, default placement, collision resolution, and storage helpers. Use a separate versioned key such as `home.widgets.v1`; do not overwrite `dashboard.preferences.v1`.
- Persist a bounded envelope `{ version: 1, widgets, preferences }`; each widget has an allowlisted type, stable singleton ID, integer `x`, `y`, `w`, `h`, and type-specific configuration. Cap the list at six and discard unknown fields/types and duplicate IDs.
- Use a 12-column desktop grid, fixed 64px row units, and 16px gaps. Define minimum/default spans per widget in one registry; start time at 4×3, weather at 8×6, calendar at 4×6, and each integration widget at 6×6. Bound heights to 3–24 rows and stored row positions to a finite range, compacting invalid or excessive gaps during normalization.
- Clamp widths/positions to the grid and enforce widget-specific minimums. Place the edited widget first, then relocate colliding widgets downward in stable order to the first available cells. Use the same deterministic placement algorithm for load repair, additions, pointer edits, and keyboard edits.
- Below 768px, project widgets into a single column in saved spatial order with natural content height. Do not rewrite desktop coordinates on viewport changes; provide move-up/down and size controls on mobile so configuration remains usable without horizontal overflow.
- Persist only successful completed changes, not every pointer move. Treat malformed/unsupported stored data as defaults, retain an explicitly saved empty layout, and report storage failure while keeping the current session usable.
- Initialize home time/weather preferences from normalized existing dashboard preferences only when no home state exists, then save them independently. Widget membership determines visibility; ignore inherited dashboard visibility flags for home membership.
- Store only presentation settings and stable selection keys. Do not persist credentials, control/collection tokens, calendar snapshots, or integration response bodies.

### Interaction and lifecycle

- Add `public/home-widgets.js` for the widget registry, mount/unmount coordination, edit state, and Pointer Events handling. Keep geometry logic in `home-layout.js` independent of the DOM.
- Use pointer capture for mouse/touch/pen move and resize, snap previews to grid cells, and release capture on completion, cancellation, Escape, resize, or teardown. Restrict `touch-action: none` to handles so widget content and the page remain scrollable.
- Add accessible move and resize labels, visible focus, keyboard arrow movement/resizing, and explicit position/size controls in Settings. Announce completed moves and sizes through a status region; preserve logical focus and reading order after reordering.
- Preserve widget DOM/controller instances when only geometry changes. Reconcile additions/removals by ID rather than rebuilding the entire home tree on every pointer move or data response.
- Clock runs only while mounted and the page is visible. Weather/calendar reuse their existing active/inactive semantics. Removing them stops timers and aborts obsolete requests; re-adding starts exactly one active owner.
- Existing integration requests load on mount, explicit refresh, connection changes, and relevant actions; do not add an unrelated polling cadence. Opening a Settings picker may fetch its integration while its widget is absent.
- Invalidate late integration responses on removal, connection replacement, or disconnect. On pagehide stop active work; on persisted pageshow restore usable owners without duplicate listeners or timers. Distinguish suspension from permanent disposal.

## Implementation Steps

### 1. Build the home layout model and shell

- Implement the normalized storage envelope, defaults, bounded grid operations, edit draft/save/cancel, and responsive projection in `public/home-layout.js` with injected storage for tests.
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
- Keep dense widget content inside a scrollable card body at desktop fixed heights, with accessible headers/status and controls outside clipped regions. Use natural height in the narrow-screen projection.
- Ensure moving/resizing does not recreate active forms, reset searches/collection selection, duplicate handlers, or dispatch device actions. Save/Cancel must restore all displaced widget positions as one layout operation.

### 6. Documentation and release record

- Document home widget setup, catalog, edit/save/cancel, resize handles, mobile behavior, local-only persistence, selected Home Assistant readings, and access to integration settings after widget removal in `README.md`.
- Describe the separate `/dashboard` photo experience and preference keys accurately. Bump `package.json` from `0.15.2` to `0.16.0` for the new home capability.
- Create `tasks/26-customizable-home-widgets/3-implemented.md` before changing implementation code, then maintain it with final behavior, changed files, verification results, and departures before the implementation commit.

## Verification Plan

- Add `test/home-layout.test.js` covering malformed storage, unsupported versions, empty layout, duplicates, bounds, deterministic collision handling, add/remove/re-add, save/cancel, responsive projection without persistence damage, and storage failure.
- Add `test/home-widgets.test.js` using injected event/scheduler/controller seams for gesture commit/cancel, keyboard equivalence, non-handle action isolation, removal during requests, no duplicate owners during geometry edits, hidden/resume, and page restoration. Exercise behavior rather than asserting source text alone.
- Extend `test/home-assistant.test.js` and `test/home-assistant-api.test.js` for stable device/reading IDs across rename/reorder/token rotation, distinct server namespaces, missing selections, and continued rejection of selection IDs as control tokens. Adjust exact response expectations for additive public fields and retained internal measurement identity.
- Extend home server/static checks in `test/app-server.test.js`, `test/linkwarden-server.test.js`, and `test/dashboard.test.js` for the catalog/shell/assets, reachable integration settings, and continued photo dashboard aliases. Update only assertions invalidated by the planned UI/API changes.
- Retain and run calendar/weather lifecycle and integration regression tests. Run `node --test test/home-layout.test.js test/home-widgets.test.js test/home-assistant.test.js test/home-assistant-api.test.js test/dashboard-calendar.test.js test/dashboard.test.js`, then `npm test`, `npm run check`, and `git diff --check`.
- In a browser, add/remove each widget, move and resize with mouse/touch/keyboard, exercise collision displacement, save/reload, cancel changes, empty the layout, and test blocked storage and 320px/mobile/desktop viewport transitions.
- Verify settings access after removal, Wake-on-LAN CRUD/bulk actions, bookmarks collection navigation, Home Assistant selection persistence after rename/reload and control refresh, missing readings, calendar automatic refresh, and weather location changes. Use fixtures or a configured local service; record unavailable live checks honestly.
- Verify tab hide/resume and browser back/forward restore do not multiply requests or timers, layout editing never triggers actions, and `/dashboard` still loads existing preferences and photo/calendar/weather functionality.

## Acceptance Criteria

- `/` is a usable widget dashboard with all six requested widget types available from Settings.
- Edit widgets enables drag-and-drop and visible resize dots; pointer and keyboard edits are bounded, nonoverlapping, cancelable, and persistent after saving.
- Widget removal does not delete integration configuration or devices, and the home page remains configurable with zero widgets.
- Home Assistant shows chosen devices and readings using stable identities across refreshes and renames; controls continue using current server-issued tokens.
- Time, weather, and calendar work on home with correct settings and lifecycle behavior, including automatic-only calendar refresh.
- Existing Wake-on-LAN, bookmarks, Home Assistant management, and `/dashboard` workflows remain usable.
- Responsive layout, unavailable integrations, malformed/blocked storage, and late responses have explicit tested behavior.
- README, version, implementation record, automated checks, and browser-verification evidence match the delivered feature.

## Planning Verification

- Read the shared workflow conventions, current request, and existing task directory before choosing task number 26; inspected home/dashboard markup, entry modules, helpers, controllers, server response mapping, Home Assistant identity normalization, tests, documentation, and package metadata.
- This planning task creates only `tasks/26-customizable-home-widgets/1-plan.md`. Implementation and test changes belong to the subsequent implementation task.
