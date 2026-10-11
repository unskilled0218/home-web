# Task 28: Streamlined Home Widgets

## Objective

Simplify the home widget canvas by removing widget border lines and visible widget titles, limiting the home weather widget to current conditions, and exposing Save and Cancel beside Settings while widget editing is active.

## Request and Scope

- Source: `~/workdir/command.md`: remove widget border lines, remove widget titles, show only current weather without hourly or daily forecasts, and show Save and Cancel beside Settings in edit mode.
- Apply these changes to the customizable home widget page at `/`. Do not alter the separate photo dashboard at `/dashboard`, which keeps its current hourly and daily forecasts and styling.
- Interpret "remove title from widgets" as removing the editor-generated visible widget heading text. Preserve each widget's existing accessible name and keep move/remove/resize controls labeled with the widget name.
- Interpret "remove border line" as removing the outer border from every home widget in normal display. Preserve the edit-mode outline and focus indicators so widget boundaries and controls remain understandable while arranging the layout.
- Keep current weather details, status/error text, air quality, units, stale-data behavior, refresh lifecycle, and weather location settings. Remove only the home widget's Hourly and Daily headings/lists and their rendering work.
- Keep Save and Cancel in the Settings dialog as well as adding edit-only toolbar actions. Both locations must operate on the same draft and share saving, conflict, error, and disabled states.
- Preserve server-shared settings, independent desktop/mobile layouts, geometry behavior, fullscreen behavior, integrations, and the existing Settings workflow.

## Inspected Context

- The project is version `0.16.1` on branch `27-fullscreen-widget-layout` at `83b9fb6` before this planning change. After inspecting `tasks/`, this is a new Task 28 rather than a revision of an earlier plan.
- `public/index.html` currently renders only `#home-settings-open` in `.home-toolbar`. The Settings dialog contains `#home-dialog-save` and `#home-dialog-cancel`, and the home weather section contains current conditions, air quality, Hourly/Daily headings, and `#home-hourly`/`#home-daily` lists.
- `public/app.js` owns render-state presentation. It marks Settings with an unsaved-changes accessible label and currently updates disabled state only for the dialog Save/Cancel controls.
- `public/home-shell.js` owns Settings, Save, and Cancel actions. Its current save handler closes the dialog after success, while cancel discards the draft, closes the dialog, and cancels an active gesture. New toolbar controls should call the same operations without duplicating draft logic.
- `public/home-widgets.js` creates a `.widget-heading` for every widget, inserts a visible `h2` from `WIDGETS[id].label`, and places Move/Remove controls in that heading. The generated title can be removed while retaining the heading as edit-control layout or replacing it with an equivalent controls container.
- Widget roots already carry accessible names: time, weather, and calendar use `aria-label`; bookmarks, Home Assistant, and Wake-on-LAN use `aria-labelledby` references to their existing section headings, which are visually hidden inside the widget canvas. Removing the generated title must not remove those source headings or break those references.
- `public/styles.css` gives `.home-grid .home-widget` a `1px` border and gives `.editing .home-widget` a dashed outline. It also styles generated heading titles and home forecast lists.
- `public/home-information.js` imports forecast-only helpers, creates forecast list items, clears and fills `#home-hourly` and `#home-daily`, and separately renders current weather and air quality. `createWeatherController` is shared with `/dashboard`; changing its provider query globally would unnecessarily alter the photo dashboard.
- `test/home-widgets.test.js` exercises the real editor against a minimal DOM but does not assert generated title/chrome behavior. `test/home-shell.test.js` covers dialog Save/Cancel, fullscreen, and explicit cancellation. `test/dashboard.test.js` asserts home markup placement and the separate dashboard's forecast markup/styles.

## Behavioral Decisions

### Widget Chrome

- Remove the visible editor-generated widget name from every home widget in both normal and editing modes. Do not hide or delete integration-owned headings that serve `aria-labelledby`; they should remain screen-reader names while staying visually suppressed by the existing canvas styles.
- Keep Move and Remove together in the widget's top edit-control area and keep Resize at the bottom-right. The top control container should consume no visible space when its controls are hidden outside edit mode.
- Remove the normal outer widget border without adding a replacement separator. During editing, retain the dashed outline and visible controls so users can identify widget bounds.
- Remove CSS that exists only for generated title text or deleted home forecast lists, while retaining current-weather icon/temperature styling and internal content scrolling.

### Current Weather Only

- Remove the home-only Hourly and Daily headings and lists from `public/index.html`.
- Simplify `public/home-information.js` so `renderWeather()` updates status, current conditions, and air quality without looking up deleted elements or constructing forecast items. Remove imports/helpers that become unused.
- Continue using the shared weather controller and normalized forecast response because `/dashboard` still consumes hourly/daily data. Do not change `public/dashboard.html`, `public/dashboard.js`, `public/dashboard.css`, `weatherUrls()`, or `normalizeForecast()` for this home-only presentation request.
- Preserve behavior for no location, loading, partial/stale forecast failure, weather refresh while visible, and air-quality failure independently of current conditions.

### Edit Toolbar Actions

- Add Save and Cancel buttons immediately adjacent to Settings in `.home-toolbar`, hidden when there is no draft and shown whenever `state.editing` is true. Use unambiguous accessible labels; the visible labels may be concise `Save` and `Cancel` because their placement establishes widget-edit context.
- Use the same settings-controller operations as `#home-dialog-save` and `#home-dialog-cancel`. Avoid separate save/cancel implementations that could diverge between toolbar and dialog.
- Save should remain disabled while saving or when a revision conflict prevents commit. Cancel should remain disabled only while saving, matching the dialog controls. Keep Settings usable during editing and saving.
- A successful toolbar save should leave the canvas in normal mode and move focus to Settings before the now-hidden Save button becomes unreachable. A failed save should retain the draft, keep the toolbar actions visible, and surface the existing error through status/Settings without discarding work.
- Toolbar Cancel should cancel any active move/resize gesture, discard the complete draft, return focus to Settings, and trigger the existing reload behavior. It must not open or close Settings as a side effect.
- Dialog Save/Cancel retain their current modal-closing behavior. Extract or expose shared action functions in `createHomeShell()` as needed so toolbar and dialog paths have consistent persistence and cancellation semantics while handling focus appropriate to each location.

## Implementation Steps

1. Create `tasks/28-streamlined-home-widgets/3-implemented.md` before implementation edits, then record actual changes, verification, and any departures from this plan.
2. Update `public/index.html` to add hidden edit Save/Cancel controls beside Settings and remove the home weather Hourly/Daily headings and lists. Keep the dialog controls and current-weather/air-quality nodes.
3. Update `public/app.js` to toggle and disable both toolbar actions from settings state, preserving Settings' unsaved-change label and existing status/conflict messages.
4. Update `public/home-shell.js` to route toolbar and dialog controls through shared save/cancel behavior, cancel gestures before discard, and manage focus safely when toolbar actions hide after completing.
5. Update `public/home-widgets.js` to stop generating visible widget-title elements while preserving labeled edit controls, stable roots, gesture behavior, and the top control container needed by Move/Remove.
6. Update `public/home-information.js` to render current weather and air quality only on the home page and remove home forecast helper/import usage without changing the shared weather transport or photo-dashboard renderer.
7. Update `public/styles.css` to remove home widget borders, collapse hidden normal-mode edit chrome, retain edit outlines, lay out the three toolbar actions responsively, and delete home-forecast/title rules that no longer have matching markup.
8. Update `README.md` to describe title-free, borderless home widgets, current-only home weather, and edit-mode Save/Cancel beside Settings while clearly retaining the full forecast on `/dashboard`. Bump `package.json` from `0.16.1` to `0.16.2` for the focused home UI change.
9. Complete automated and browser verification, update the implementation record with factual results and limitations, and commit the Task 28 implementation on its task branch.

## Verification Plan

- Extend `test/home-widgets.test.js` to assert the editor does not create a visible title element, retains correctly labeled Move/Remove/Resize controls, hides the top edit-control chrome outside editing, and preserves existing pointer/keyboard geometry behavior.
- Extend `test/home-shell.test.js` with toolbar Save success/failure and Cancel paths. Verify shared settings operations, gesture cancellation, draft retention after failed save, focus return to Settings, dialog behavior, and no duplicate calls from either control location.
- Update `test/dashboard.test.js` home markup assertions to require toolbar Settings/Save/Cancel placement, initial hidden state for edit actions, absence of home Hourly/Daily markup, and absence of generated-title-dependent styling where appropriate. Retain all assertions proving `/dashboard` still serves hourly/daily forecast markup and behavior.
- Add focused home-information coverage with an injectable document/weather seam if practical, or extend the existing DOM/static coverage to prove current conditions and air quality render without `#home-hourly`/`#home-daily`. Cover no-location, loading, stale forecast, and partial air-quality states so removing lists does not introduce null-element failures.
- Run `node --test test/home-widgets.test.js test/home-shell.test.js test/dashboard.test.js` plus any new home-information test, then run `npm test`, `npm run check`, and `git diff --check`.
- In a browser, verify desktop and mobile normal mode show borderless widgets with no visible widget names and only Settings in the toolbar. Confirm content remains distinguishable and scrollable without border/title spacing regressions.
- Enter edit mode and verify Move/Remove/Resize controls and dashed widget bounds remain visible, Save and Cancel appear beside Settings without overlap at 320px width, keyboard focus is visible, and Settings still opens.
- Verify toolbar Save persists a move/resize after reload, toolbar Cancel restores saved geometry, failed/conflicting saves retain visible actions and the draft, and focus lands on Settings after successful Save or Cancel.
- Verify the home weather widget shows current icon, temperature, condition, wind, humidity, precipitation, AQI, and relevant status/error text but no Hourly or Daily sections. Verify `/dashboard` still shows and refreshes its hourly and daily forecasts unchanged.

## Acceptance Criteria

- Home widgets have no outer border line or visible generated title in normal or edit mode; editing still has a clear dashed boundary and accessible labeled controls.
- The home weather widget renders only current conditions and air quality, with no hourly/daily headings or list elements and no runtime access to removed nodes.
- `/dashboard` retains its existing current, hourly, and daily weather presentation and provider behavior.
- Save and Cancel appear directly beside Settings only while a widget-settings draft exists, reflect saving/conflict state, and execute the same persistence/cancellation rules as the dialog controls.
- Successful toolbar actions do not strand focus on hidden controls; failed saves retain the draft and actionable controls; Cancel terminates active gestures before restoring saved state.
- Desktop/mobile layouts, shared settings, fullscreen, integrations, status/error handling, and existing geometry interactions continue to work.
- Documentation, version `0.16.2`, implementation record, automated results, and browser-verification status accurately match the delivered behavior.

## Planning Verification

- Read the shared project/task conventions and current request, inspected task numbering, Git state/history, home markup, render state, shell actions, widget editor, weather renderer/controller boundary, CSS, documentation, and relevant tests before writing this new plan.
- This planning change adds only `tasks/28-streamlined-home-widgets/1-plan.md`; implementation code is unchanged.
