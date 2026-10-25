# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Persist a Local-only playback option](#1-persist-a-local-only-playback-option)
    - [2. Add the Images setting and draft handling](#2-add-the-images-setting-and-draft-handling)
    - [3. Route playback to the selected source](#3-route-playback-to-the-selected-source)
    - [4. Add regression tests](#4-add-regression-tests)
    - [5. Update documentation and validate](#5-update-documentation-and-validate)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Add an optional “Show the same image as Global” setting under Settings → Images for Local dashboards. Default it to on. Enabled Local dashboards follow the existing server slideshow while retaining their own presentation, weather, layout, and other preferences. Disabled Local dashboards retain existing independent playback.

Do not change server selection, photo inventory limits, Global preferences, Global import/export, or API contracts. This task plans implementation only.

## Implementation Plan

### 1. Persist a Local-only playback option

- In `public/dashboard-settings-data.js`, extend the Local settings envelope with a boolean `followGlobalPhotos`, outside `preferences`. Accept existing schema-1 records without this field as true, preserve explicitly saved false values, reject invalid present values and unknown fields, and retain existing size and revision validation.
- In `public/dashboard-settings-scope.js`, initialize the option to true for fresh and legacy Local profiles and expose its confirmed value through `getState()`. Preserve it across weather-location saves, layout saves, ordinary preference saves, reloads, and scope changes.
- Extend the coordinator's `save(preferences, token, options)` path with an optional Local playback value so the form can save both preferences and the option in one Local record/revision. Calls without the option must preserve the saved value. Reject attempts to set this Local-only option through a Global save before sending a request.
- Keep existing source/revision tokens, read-before-write checks, storage errors, same-profile storage events, and dirty-draft protections. Do not add the option to `PREFERENCE_KEYS`, server preferences, or Global transfer payloads.

### 2. Add the Images setting and draft handling

- In `public/index.html`, add an accessible checkbox associated with the preferences form and explain that Global controls image selection and rotation while Local presentation stays independent. Hide the option in Global mode.
- In `public/dashboard.js`, populate and read the checkbox separately from shared preference fields. Include it in draft dirtiness, Save, reload/discard, source-change handling, and saving/disabled states. Do not apply an unsaved checkbox change to active playback.
- While the Local draft follows Global, disable Order and Interval controls with explanatory text, but preserve their values in the draft and saved Local preferences. Keep transition, filename, opacity, blur, and background controls available. Restore Order and Interval controls when following is off, including after switching scope or reloading.
- Keep the option out of `readPreferenceDraft()`'s shared preference object. On Local submit, pass its draft value through the coordinator's atomic save path; Global submit must omit it.
- Track the confirmed option separately from `settings` and ensure its changes trigger photo reconfiguration even when scope/source and all ordinary preferences remain unchanged. Storage events must update playback without overwriting an open dirty draft.

### 3. Route playback to the selected source

- In `public/dashboard-photo-scope.js`, accept the confirmed Local option explicitly. Select `createPhotoController` for Global mode or Local mode with following enabled; otherwise select `createLocalPhotoController`.
- Include both settings source epoch and effective playback source in owner identity. Changing the option within the same Local epoch must dispose the old owner, cancel obsolete work, configure the replacement, and load its current selection. Presentation-only changes must not restart the owner.
- Continue passing Local presentation settings to the Global follower. Do not fetch or adopt Global preferences: `createPhotoController` already reads `/api/dashboard/slideshow?version=2`, uses server selection/deadlines, and supports bounded lookahead and recovery.
- Reuse existing visibility, retry, decode cancellation, last-good-frame, and disabled/empty-source behavior. Never run independent Local rotation or manifest polling while following Global, and never mutate or advance the server sequence from a follower.
- Turning the option off starts the existing Local player with its preserved order/interval. Do not promise restoration of an earlier in-memory Local cursor after its controller was disposed.

### 4. Add regression tests

- Extend `test/dashboard-settings-scope.test.js` to cover old-record defaulting, new-record round trips, invalid values, atomic option/preference saves, preservation through weather and ordinary/layout saves, scope round trips, same-profile updates, independent profiles, stale tokens, storage failures, and rejection of Global option writes.
- Add `test/dashboard-photo-scope.test.js` using existing slideshow clocks, fake fetch/decode work, and lifecycle fixtures. Verify default Global-following routing for Local mode, explicitly disabled independent Local routing, toggling within one scope epoch, presentation updates without replacement, hidden/resume behavior, disposal, and rejection of late reads/decodes from retired owners.
- Extend `e2e/settings-scope.spec.js` and its fixtures as needed to run separate Local and Global browser contexts against a controllable slideshow. Assert that Local follows the Global current image by default and follows later server changes without changing server preferences or cursor through browser writes. Update existing independent Local playback tests to explicitly disable following first.
- Verify that reload and Local → Global → Local preserve both enabled and explicitly disabled choices; a second independent Local profile defaults to on and remains unchanged when the first disables following; same-profile tabs follow committed changes; unsaved edits do not change playback; and save failures retain the confirmed mode and draft.
- Verify that turning the option off restores independent Local playback with saved order/interval, while timezone, weather city, layout, and image presentation remain Local. Cover a delayed old-owner decode during a toggle and disabled/empty/unavailable server snapshots using existing recovery fixtures where practical.

### 5. Update documentation and validate

- Update `docs/settings-scope.md` and `docs/nfs-backgrounds.md` to describe default Global following and optional independent Local playback, including Local presentation, ignored-but-preserved order/interval, storage location, and switching behavior. Explain that existing profiles without an explicit choice also default to following Global. Update the Images-panel description in `public/index.html`.
- State that “same image” means following the same server selection with the existing polling/decode delay, not frame-perfect synchronized transitions. Global following can show any eligible server-selected image rather than the independent Local manifest's 100-image subset.
- Run `npm run check`, `npm test`, and `npm run test:browser`. During development, use `node --test test/dashboard-settings-scope.test.js test/dashboard-photo-scope.test.js` and `npm run test:browser -- e2e/settings-scope.spec.js e2e/server-photo-rotation.spec.js e2e/photo-display-recovery.spec.js` for focused checks. Record unavailable runtime/browser prerequisites rather than installing system packages.

## Acceptance Criteria

- Fresh, legacy, and existing Local profiles without the option follow Global by default; an explicitly saved false value remains off.
- Local viewers with following enabled follow the same server-selected current image as Global viewers and catch up after visibility resumes, within existing polling/decode behavior.
- The option survives reload, scope round trips, unrelated Local saves, and same-profile storage synchronization without changing another browser profile's choice.
- Turning the option off restores independent Local playback with retained Local order/interval. Local presentation and all unrelated settings remain independent in either state.
- No Global setting, transfer schema, server selection algorithm, inventory limit, or write endpoint changes are required. Local followers do not poll the Local manifest or run Local rotation.
- Source changes leave one active photo owner; stale reads and decodes cannot replace the new source's image. Existing retry, last-good-image, disabled, and empty-source behavior remains intact.
- Targeted and full checks pass, or any environment blockers are explicitly recorded.

## Risks And Decisions

- Store the option in the Local envelope rather than shared preferences to avoid expanding strict Global validation and import/export contracts. Older Local records default to on without being rewritten merely by reading them. This intentionally changes playback for existing profiles without an explicit choice; users can disable following to restore independent playback.
- Save the option and Local preferences atomically under the existing revision token; a separate storage key or immediate checkbox write would bypass form semantics and risk partial saves.
- Keep Global polling and image decoding unchanged. Network latency, hidden tabs, failed decodes, and Local transition settings can temporarily produce different visible frames despite a shared authoritative selection.
- Changing playback source intentionally retires the old controller and its traversal state. Preserve saved Local configuration, not an unsaved runtime cursor.
- Old cached application versions may reject Local records containing the new field because existing Local validation is strict. Document this compatibility limit; do not weaken validation or silently discard the option.
