# goal

## command

- options to display on background with checkbox
  - Display on background
    - Time, Weather, others

Request source: `~/workdir/command.md`.

## goal

Provide a clear **Display on background** checkbox group in Settings so users can choose which dashboard information sections appear over the photo or color background.

## Current Behavior

- `public/index.html` renders Time, Weather, Calendar, Bookmarks, Home Assistant, and Wake-on-LAN alongside the background photos.
- Time, Weather, and Calendar already have independent desktop/mobile visibility checkboxes scattered across their respective Settings tabs. `public/dashboard-helpers.js` stores and projects those preferences for the current viewport.
- Bookmarks has a fullscreen-only hiding option, but no general display checkbox. Home Assistant and Wake-on-LAN currently render their dashboard sections without general visibility controls.
- Dashboard preferences already persist in SQLite, synchronize across browsers, and use revision checks with explicit Save preferences and Reload shared preferences. Integration connections and bookmark/device choices have separate owners.
- Background image effects and image-info options are separate from information-section visibility. The new group must not confuse “display on background” with the existing color/blur background effect setting.

## Required Outcomes

- Add an accessible group labeled **Display on background**, preferably in Settings → General, containing checkboxes for **Time**, **Weather**, **Calendar**, **Bookmarks**, **Home Assistant**, and **Wake-on-LAN**.
- Checking a section enables its dashboard display; unchecking it hides that section. Make this the clear place to manage overlay visibility rather than introducing conflicting duplicate controls.
- Reuse existing Time/Weather/Calendar visibility values and preserve the established independent desktop/mobile preferences when consolidating controls. Define the matching profile behavior for the remaining sections during planning; opening or upgrading Settings must not silently overwrite either profile.
- Keep visibility changes as preference drafts until Save preferences succeeds. Persist them across browser reload and application restart and synchronize them through the existing shared-settings revision/conflict model.
- Hiding a section must not delete its connection, selected links/devices, credentials, cached data, or display-format/scale preferences. Its Settings controls must remain available while the dashboard section is hidden.
- Preserve bookmark new-tab navigation and flat selected-link presentation, Home Assistant read-only snapshots, and Wake-on-LAN behavior when those sections are enabled again.
- Remove layout space reserved solely for hidden overlays. Handle any combination of visible sections cleanly on desktop and mobile, including all sections disabled while the background remains visible.
- Keep Settings and fullscreen controls reachable even when every overlay is hidden. Preserve existing image/background behavior and keep the optional image-info control separate.
- Compose normal visibility with fullscreen hiding consistently: a section disabled by its display checkbox must not reappear on fullscreen exit. Do not add duplicate polling/refresh owners or request loops when visibility changes.
- Default newly introduced visibility preferences to current visible behavior for existing installations. Preserve existing saved hidden states for Time/Weather/Calendar and upgrade old stored/cached preferences without read-time destructive writes.

## Acceptance Criteria

- Settings exposes the named checkbox group with all six dashboard sections and clear desktop/mobile behavior.
- Each checkbox controls only its corresponding overlay. Saved selections survive reload/restart and synchronize across browsers without erasing unrelated settings or dirty drafts.
- Hidden sections occupy no dedicated empty layout area, remain configurable in Settings, and recover their saved content/preferences when enabled again.
- Disabling every overlay leaves a usable background-only dashboard with Settings/fullscreen controls accessible. Resizing and fullscreen transitions do not restore disabled sections or change stored choices.
- Focused unit/API and browser tests cover defaults/upgrades, profile preservation, save/conflict behavior, each visibility toggle, mixed/all-hidden layouts, re-enabling integrations, and fullscreen/mobile transitions. Existing tests remain passing.

## Scope Boundary

This task controls dashboard overlay visibility only. It does not delete or reconnect integrations, redesign background images, change bookmark selection or device data models, add authentication, or automatically fix archived review findings. This goal stage modifies no implementation code, dependencies, project version, user data, or `todo.md`.
