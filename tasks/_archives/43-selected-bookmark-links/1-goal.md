# goal

## command

- display selected link only from bookmarks
- open link in new tab

Request source: `~/workdir/command.md`.

## goal

Allow users to choose individual Linkwarden bookmark links for the dashboard. Show only the selected links in the dashboard Bookmarks area, and open each link in a new browser tab without replacing the dashboard.

## Current Behavior

- `public/dashboard-bookmarks.js` discovers the Linkwarden collection tree and loads direct bookmarks from disclosed folders, with refresh, caching, request limits, and connection-change handling.
- `public/dashboard-bookmark-tree.js` renders all loaded links for each folder. Its bookmark anchors currently have no new-tab target.
- Settings → Bookmarks in `public/index.html` provides display and connection controls, but no individual-link picker.
- `public/bookmark-data.js` validates bookmark IDs and permits only HTTP/HTTPS destinations. Collection access tokens are temporary server-issued handles; they are not durable bookmark choices.

## Required Outcomes

- Provide an accessible way to select and deselect individual bookmark links under Settings → Bookmarks. Keep the available bookmark catalog usable there even when unselected links are hidden from the dashboard.
- Persist dashboard link choices across page reloads and server restarts, following the project's shared-settings convention so browsers use the same saved choices. Keep selection saves independent from Linkwarden credential changes and other preference drafts.
- Render only selected, available, safe bookmark links on desktop and mobile. Do not expose unselected links through expanded folders or a presentation-mode change. If folder grouping remains, omit groups with no displayed selected descendants.
- Give an explicit empty-selection state and selection guidance rather than silently showing all bookmarks. Define the transition for installations with no stored link selection during planning; do not confuse an absent setting with an explicitly saved empty selection.
- Identify choices by durable bookmark identity scoped to the Linkwarden source, not display names, URLs, or expiring collection tokens. Renamed links, duplicate names, refreshed tokens, deleted bookmarks, and connection changes must not silently select a different link.
- Preserve saved choices during transient provider failures or stale responses. Missing or unavailable links must not cause automatic destructive preference writes or selection of replacement links.
- Open dashboard bookmark links using native anchors with `target="_blank"` and appropriate opener protection such as `rel="noopener noreferrer"`. Preserve keyboard activation and existing safe URL validation; do not add JavaScript popup handling or allow unsafe URL schemes.
- Retain current desktop/mobile sizing, fullscreen hiding, connection security, provider request bounds, and useful refresh/retry behavior. Do not alter unrelated dashboard widgets or shutdown behavior.

## Acceptance Criteria

- Selecting a subset of available links shows exactly that subset on the dashboard; unselected links remain available for selection in Settings.
- Deselecting all links produces an explicit empty state. Saved choices survive browser reload and application restart and synchronize through the existing shared-settings model.
- Selection remains correct through bookmark renames, duplicate names, catalog refreshes, missing links, and Linkwarden source changes. Transient errors do not erase choices or expose unselected content.
- Clicking or keyboard-activating a selected link opens its HTTP/HTTPS destination in a new tab and leaves the dashboard open. Unsafe URLs remain excluded.
- Focused unit/API and browser tests cover selection persistence, filtering, source identity, empty/missing/error states, independent drafts, desktop/mobile presentation, and new-tab behavior. Existing tests remain passing.

## Scope Boundary

This task concerns individual bookmark selection and link navigation only. It does not add Linkwarden bookmark editing, collection management, unrelated layout redesign, or fixes for the archived shutdown review warnings. This goal stage modifies no implementation code, dependencies, version, user data, or `todo.md`.
