# plan

## scope

Make Settings → Weather's clear action clear only location search results. Use **Clear results** for the button and **Search results cleared.** for its status. Preserve the selected location, stored preferences, search query, unsaved display edits, and weather display. Limit changes to the existing handler, button text, affected browser checks, and README instructions.

## Implementation Plan

### 1. Make the clear handler results-only

- In `public/dashboard.js`, change the `#clear-location` click handler to call `cancelSearch()`, empty `#location-results` with `replaceChildren()`, and set `#search-status` to `Search results cleared.`.
- Remove the location-to-null assignment, `normalizeSettings`, `save`, and `apply` calls from this handler. Do not change the selected `settings.location`, any other applied settings, the search query, preference form values, or `#settings-status`.
- Reuse the existing `cancelSearch()` behavior: increment `searchGeneration` and abort `searchController`. Keep both success and failure generation checks in the submit handler so a completed obsolete search cannot restore results or overwrite the cleared status.
- Keep result selection as implemented: choosing a result normalizes, saves, and applies its location. Subsequent searches must continue to work normally after cancellation or clearing.

### 2. Align the button and instructions with its behavior

- In `public/index.html`, replace the visible `Clear location` button text with `Clear results`. Keep `id="clear-location"` and `type="button"` so the action remains independent of form submission and existing bindings need no rename.
- In `README.md`, replace the statement that weather location selection/clearing saves immediately. Explain that selecting a location saves it immediately, while Clear results removes the result list and cancels the current search without changing the selected location or search text.
- Check current frontend and test references for `Clear location` and `Location cleared.` and update affected expectations. Historical task documents remain records of the earlier behavior.

### 3. Update meaningful behavioral regression checks

- Adapt the existing weather search/selection/clearing case in `e2e/dashboard-home.spec.js` to click `Clear results` and expect `Search results cleared.` and an empty result list.
- Keep the existing unsaved General scale edit, then add explicit preservation assertions after clicking Clear results: `#location-query` still contains the searched text, and switching to General still shows the unsaved overall scale value `1.4`. The current case checks the draft only before clearing and has no query-preservation assertion. Snapshot the entire raw `dashboard.preferences.v1` value after selecting a location and compare it exactly after clearing; the selected location and all saved preferences must remain unchanged.
- Replace that case's aborted weather/air-quality routes with deterministic successful fixtures so current weather is rendered before clearing. Assert weather information remains visible with the same values after clearing, and observe provider requests to ensure the action introduces no refresh. Keep fixture dates fixed and avoid live provider access.
- Verify the selected location still loads after a page reload, then reopen Settings → Weather and confirm another search and result selection can replace it normally.
- Add a focused pending-search case: wait until a geocoding search is in flight, clear results, then allow the obsolete response to finish. Assert results stay empty, the cleared status persists, and saved location/preferences and query text remain unchanged.
- To test the generation guard independently of normal network abortion, use a test-only, controlled geocoding `fetch` stub that observes its aborted signal but still resolves after clearing. Forward all other requests normally, resolve or release pending work during cleanup, and wait for the controlled response processing rather than using arbitrary sleeps. Exercise the real search handler and assert browser-visible behavior; no production abstraction or test hook is needed.
- Cover repeated clearing with no results and no selected location in the pending-search case or a compact additional scenario. Confirm storage remains absent or unchanged, no location is created, and the button does not submit the search form. Retain the existing page-error checks.

### 4. Verify and record the implementation

- Run `npm test`, `npm run check`, and `node --check public/dashboard.js` plus `node --check e2e/dashboard-home.spec.js`. Run the focused weather/results browser cases first, then `npm run test:browser` if browser launch works. Check `git diff --check`.
- If Chromium still cannot launch, record the actual dependency error and ask the user to install its system libraries. The last run was blocked by missing `libglib-2.0.so.0`; successful HTTP or markup checks cannot establish cancellation and display behavior in the browser.
- Inspect the diff to confirm clearing no longer mutates preferences or calls dashboard `apply`, and that selected-location behavior, service controllers, and backend APIs keep their existing behavior.
- Record actual changes, commands, results, and any browser blocker in this task's `4-implemented.md` when implementing. Follow the implementation workflow's branch, patch-version update, and commit conventions; current project version is `0.17.4`.

## Acceptance Criteria

- The Weather tab shows **Clear results** and reports **Search results cleared.** after the action.
- Clearing empties only the result list and updates search status while preserving query text, unsaved preference edits, selected location, and the exact stored preferences value.
- Existing weather information remains visible; clearing does not save preferences, reapply dashboard settings, or request a weather refresh.
- Pending searches are canceled and invalidated. A late success or failure cannot repopulate the results or replace the cleared status.
- Clearing is repeatable and works without a selected location or existing results. New searches and result selection continue to work afterward, and selected locations survive reloads.
- README and current test expectations describe results-only clearing. Server/unit and syntax checks pass; browser checks pass or their environment blocker is recorded accurately.

## Risks And Decisions

- Keep the existing button ID despite its old name to avoid unrelated markup/binding changes. The visible label and status explicitly communicate results-only behavior.
- Abort and generation invalidation solve different parts of cancellation. Retain both so stale work cannot alter the UI even if its response completes despite cancellation.
- The selected location remains a saved preference, while search results/query/status are transient UI state. Clear results must not cross that boundary.
- Do not add a separate remove-location action, reset search text, change the persistence format, or refactor service controllers for this request.
- Use the existing browser suite and a narrowly scoped response fixture for the race regression. Avoid implementation-mirroring unit tests or a new test framework for this small handler change.
