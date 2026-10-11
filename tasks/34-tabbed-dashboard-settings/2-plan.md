# plan

## scope

Redesign the photo dashboard's Settings dialog with a left-side Time, Weather, Calendar, and Images tab rail and a polished dark content area. Preserve all existing preferences, weather location actions, calendar connection actions, modal behavior, and browser-local persistence. Keep shared position and overall scale controls accessible outside the four panels.

## Implementation Plan

### 1. Organize the existing controls into four panels

- Restructure only `#settings-dialog` in `public/index.html`. Keep its title and Close button in a header, shared display controls in a compact Information layout section, a left navigation rail beside the content panels, and an always-visible footer with Save preferences and `#settings-status`.
- Use four `type="button"` tabs in the exact order Time, Weather, Calendar, Images. Give the rail `role="tablist"`, an accessible name, and `aria-orientation="vertical"`; give each tab a unique ID, `role="tab"`, `aria-controls`, `aria-selected`, and roving `tabindex`.
- Give each associated panel a unique ID, `role="tabpanel"`, `aria-labelledby` pointing to its tab, and `tabindex="0"`. Initially select Time and hide the other three panels with `hidden`.
- Time contains clock visibility/scale, timezone, date style, 12/24-hour format, and seconds. Add a brief note that timezone also affects weather and calendar presentation.
- Weather contains weather visibility/scale, temperature/wind/precipitation units, and the existing location search, results, clear action, and status.
- Calendar contains calendar visibility/scale and the existing Baikal URL, username, password, connect/disconnect actions, and connection status.
- Images contains ordering, interval, transition and duration, opacity, background mode/color/blur, filename visibility, and existing NFS explanation/status.
- Keep existing control names, limits, types, IDs, labels, and password attributes. Ensure heading IDs referenced by `aria-labelledby` actually exist; use appropriate subsection headings within the panels.

### 2. Preserve independent form ownership and cross-tab saving

- Keep `#preferences`, `#location-search`, and `#calendar-connection` as independent forms. Do not nest search or calendar forms inside the preferences form.
- Use one empty `form#preferences` element as the preferences owner and explicitly associate each preference input/select and the footer Save button with `form="preferences"`. This allows panels and shared controls to be arranged freely while keeping `preferences.elements` as the single serialization source.
- Keep search controls owned by `#location-search` and credential controls owned by `#calendar-connection`; do not associate them with the preferences form. Tab, Close, Clear location, and Disconnect buttons remain `type="button"`.
- Keep inactive preference controls enabled and in the DOM. Hiding a panel must not omit its preferences from saving or discard typed values.
- Add `novalidate` to the preferences form and perform native constraint checks explicitly at the beginning of its submit handler in `public/dashboard.js`. Find the first associated control with `willValidate` and an invalid `validity`, reveal its panel, call that control's `reportValidity()`, and return before mutating settings, saving, or applying them. This avoids native attempts to focus an invalid control inside a hidden panel, including when several panels contain invalid inputs.
- After validation succeeds, retain the current serialization, `normalizeSettings`, `save`, `fillForm`, and `apply` flow. Preserve the storage key `dashboard.preferences.v1`, save-error reporting, and all existing defaults.

### 3. Add a small tab interaction owner

- Add `public/dashboard-settings.js` for the dialog's tab behavior, imported and initialized once by `public/dashboard.js`. Expose only the panel selection and control-reveal operations needed by the main module; use native DOM events without a generic tab framework or new dependency.
- A single activation operation updates all four tabs' `aria-selected` and `tabindex` values and panels' `hidden` state. Clicking a tab selects its panel; ArrowUp/ArrowDown move and activate tabs with wrapping, and Home/End select the first/last tab. Prevent the handled keys' default scrolling and focus the newly selected tab for keyboard navigation.
- Tab and Shift+Tab continue to use normal focus navigation through the selected tab, active panel, and dialog controls. Hidden panels must not contribute focusable controls to that sequence.
- Tab activation changes only navigation state. It must not call `fillForm`, `fillCalendarForm`, `save`, `apply`, or submit another form, and must not start or cancel weather/calendar/photo refresh work.
- On each Settings opening, retain the existing form-fill and calendar-status preparation, reset selection to Time, open the native modal, and focus the Time tab. Preserve the Close button, Escape dismissal, and existing dialog-close focus return to `#open-settings`.
- The control-reveal operation selects the containing panel without focusing its tab; native validation can then focus the offending input. Shared display controls require no panel change.
- Keep current weather search/location persistence, calendar pending state, connect/disconnect responses, and service controller behavior. Successful calendar connection continues to close the dialog; closing/reopening continues to refill preferences from applied settings.

### 4. Style a cohesive, responsive dialog

- In `public/dashboard.css`, scope new layout and control styles to `#settings-dialog` and its new classes so the dashboard clock, forecasts, photo layers, and fullscreen presentation keep their current styling.
- Use a bounded dialog shell with clearly separated header, shared display section, content body, and footer. Make the selected panel the scrollable area while keeping navigation and Save/Close reachable within the viewport.
- Use a two-column content grid with a modest left tab rail and `minmax(0, 1fr)` for the panel column. Give the rail a distinct dark surface, selected tabs a contrasting accent/background, and controls consistent borders, spacing, radii, and focus indicators. Distinguish selected, hovered, focused, and disabled states without relying only on color.
- Keep the tab rail on the left at narrow widths, using compact text labels and reduced padding. Switch panel fieldsets and shared display controls to single-column layouts when space is limited; apply `min-width: 0`, bounded control widths, and wrapping text to avoid the current desktop fieldset minimum causing overflow.
- Replace the broad `dialog section` separator rule where needed so every tabpanel does not inherit an unrelated top border/margin. Retain useful grouping for location, calendar connection, and NFS subsections.
- Check that the shell and scroll area shrink on short screens, focus outlines remain visible, and actions can be reached at 320px and 390px widths. Retain the existing reduced-motion preference; no animated panel transition is needed.

### 5. Adapt verification to the new navigation and form behavior

- In `test/dashboard.test.js`, extend retained asset coverage for `dashboard-settings.js` and add focused HTML assertions for exactly four tabs, unique tab/panel relationships, initial selection/hidden panels, shared display controls, and preserved form/control ownership. Keep existing root/redirect, service, and dashboard presentation tests.
- Update `e2e/dashboard-home.spec.js` to select Images before asserting NFS status and Calendar before inspecting credential fields. Keep its root, legacy navigation, persisted preferences, service rendering, and fullscreen checks.
- Add focused Settings interaction cases using the existing Playwright approach. Verify one selected tab/panel, pointer selection, ArrowUp/ArrowDown wrapping, Home/End, roving tabindex, hidden controls excluded from keyboard navigation, Escape dismissal, and focus return.
- Edit preferences in at least two panels, navigate away and back, verify unsaved values remain, then save once and verify values from both panels plus shared position/scale survive reload. Assert tab changes alone neither write storage nor submit the search/connection forms.
- Put invalid preference values in more than one panel, save from another tab, and verify the first invalid control's panel becomes visible and receives validation/focus without a hidden-control error or storage write. Correct it, verify the next invalid control is revealed, then confirm saving succeeds once all values are valid.
- With deterministic route fixtures, test weather search/select/clear and calendar connect/disconnect through their respective tabs. Ensure unrelated required credential/search fields do not block Save preferences, preference controls do not contaminate service request bodies, and failed service actions keep their status/error visible when that tab is selected.
- At 1200px, 320px, and 390px widths, verify tabs remain on the left, the dialog and content have no horizontal overflow, all four panels can be used, and Save/Close remain reachable. Inspect the actual layout and keyboard focus in an available browser rather than relying only on CSS source assertions.

### 6. Document and run the checks

- Update the README Settings description to explain the four tabs, shared Information layout controls, cross-tab Save preferences, and the Weather/Calendar/Images locations of their service controls. Preserve its browser-local storage and connection semantics.
- Run `npm test`, `npm run check`, and `npm run test:browser`. Check each changed/new JavaScript file individually with `node --check`, since the existing glob-based check command does not reliably validate all expanded arguments. Run `git diff --check` before committing.
- If browser launch remains blocked, record the actual failure and ask the user to install the needed system dependencies. The last user-provided run failed on missing `libglib-2.0.so.0` after downloading Chromium; running the HTTP server alone cannot verify tabs, focus, validation, or layout.
- Record actual changes, verification outcomes, visual/keyboard checks, and any remaining environment blocker in this task's `4-implemented.md` during implementation. Apply the project's release/version and commit conventions when the implementation workflow is invoked.

## Acceptance Criteria

- Settings presents Time, Weather, Calendar, and Images tabs on the left with one active panel and a clear, keyboard-visible selected state.
- Every existing preference and service control has a logical home; position and overall scale remain accessible as shared controls without a fifth tab.
- Pointer and vertical-tab keyboard navigation update selection and focus correctly. Inactive panels are hidden from interaction and accessibility navigation; Close/Escape return focus to Settings.
- Tab switches preserve entered values without saving or submitting forms. Save preferences validates and persists all associated preferences across panels, including inactive panels and shared controls.
- Invalid preferences in hidden panels are revealed and focused before reporting validation; multiple invalid panels cannot cause a hidden-control focus error.
- Weather location selection/clearing, calendar connect/disconnect and pending/error states, NFS status, and existing localStorage defaults/save failures retain their current behavior.
- The dark dialog has consistent spacing and controls, a left tab rail on desktop and mobile, bounded scrolling, and no horizontal overflow at 320px or 390px widths.
- Required server/unit and syntax checks pass. Browser and visual verification pass when dependencies are available; any blocked verification is recorded accurately.

## Risks And Decisions

- Form-associated controls allow separate tab panels without nesting forms or duplicating preference state. Preserve `preferences.elements` ownership explicitly for every moved preference control.
- Hidden controls still participate in constraint validation. Explicit first-invalid-control validation is required before serialization, not just before opening a panel.
- Selected tab is transient UI state and defaults to Time each time the dialog opens. It is not added to saved preferences and needs no storage migration.
- Draft preservation is guaranteed while navigating tabs. Close/reopen, location-selection persistence, and successful calendar connection retain their existing lifecycle rather than introducing a new draft or save model.
- Hiding a Settings panel must not hide or suspend the corresponding dashboard feature. Navigation state is independent of the existing visibility preferences and service controllers.
- Native browser tests are necessary for form ownership, hidden-input focus, keyboard behavior, and responsive geometry. Missing browser libraries are an environment blocker, not proof that the interaction checks pass.
