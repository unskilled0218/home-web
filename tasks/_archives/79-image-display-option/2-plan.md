# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Extend image preferences compatibly](#1-extend-image-preferences-compatibly)
    - [2. Match other display controls](#2-match-other-display-controls)
    - [3. Apply resolved visibility](#3-apply-resolved-visibility)
    - [4. Test and document](#4-test-and-document)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Match Images visibility controls to other dashboard items: desktop, mobile, and fullscreen. Reuse `imageVisible`; do not add a second general image toggle. Keep changes within image presentation, compatibility, tests, and relevant documentation.

## Implementation Plan

### Summary

The Images tab already has **Show image**, but it applies to every viewport and ignores fullscreen hiding. Other tabs have independent desktop/mobile visibility and a fullscreen override. Complete that parity without changing slideshow behavior.

### 1. Extend image preferences compatibly

- In `public/dashboard-helpers.js`, retain `imageVisible` for desktop and add boolean `mobileImageVisible` and `hideImageFullscreen` preferences.
- Default new installations to visible images in both profiles and no fullscreen hiding. When mobile visibility is absent, inherit the existing `imageVisible` value so previously hidden images remain hidden on mobile.
- Apply that missing-field upgrade consistently through normalization, stored Global records, stored Local records, legacy preferences, confirmed offline caches, and settings imports. Explicit values must win; reject malformed present fields in strict decoders.
- Extend the existing additive compatibility logic rather than maintaining separate migrations. Keep live API validation strict, including rejection of incomplete old-client writes.
- Assign both new keys exclusively to Images in `public/dashboard-settings-categories.js`. Preserve Local/Global ownership and `followGlobalPhotos`.

### 2. Match other display controls

- In `public/index.html`, place the existing **Show image** checkbox inside a **Desktop display** fieldset.
- Add **Mobile display** with **Show image on mobile**, plus **Hide image in fullscreen**, following other tabs' naming and form conventions.
- Update help text to explain the 600px mobile breakpoint, fullscreen override, Save behavior, and continued playback while hidden. Do not add image scale controls.
- Use the existing category form filling, draft tracking, validation, and saving paths in `public/dashboard.js`; verify all three fields participate without bespoke handlers.

### 3. Apply resolved visibility

- Add image visibility to `resolveDisplayPreferences()` in `public/dashboard-helpers.js`; select the active desktop/mobile preference.
- In `public/dashboard-display.js`, apply the fullscreen override to that resolved value and derive caption visibility from it. Hide the entire photo container, including blurred backgrounds, while retaining the solid background and widgets.
- Extend the image visibility change list in `public/dashboard.js` so saves and incoming Global updates immediately reapply layout for either new field.
- Reuse existing viewport, fullscreen, and photo-completion callbacks. Hidden images must remain hidden after rotation, delayed loads, reload, and page restoration.
- Keep visibility presentation-only: do not reconfigure playback, reset selection, replace photo layers, change requests or timers, or mutate saved widget geometry solely because visibility changes.

### 4. Test and document

- Extend `test/dashboard-image-visibility.test.js` for absent new fields, inherited hidden mobile state, explicit independent values, malformed fields, old imports, offline caches, and unchanged stored revisions/bytes during reads.
- Extend category, scope, transfer, and API tests to cover both new fields, strict write validation, persistence, and Local/Global isolation. Update existing fixtures that assume `imageVisible` alone controls mobile.
- Extend `test/dashboard-display.test.js`, `test/dashboard-layout-view.test.js`, and form assertions in `test/dashboard.test.js` for independent profiles, fullscreen entry/exit, captions, and unchanged custom geometry.
- Extend `e2e/image-visibility.spec.js` for all three controls, draft/save/reload behavior, widths 600 and 601, fullscreen precedence, Global propagation, and Local isolation. Retain coverage for Local-following, independent Local, and Global playback, delayed loads, and automatic/custom layouts.
- Update `docs/dashboard.md`, relevant image guidance in `docs/settings-scope.md` and `docs/nfs-backgrounds.md`, and the short Settings description in `README.md` to explain the three controls.
- Run `npm run check`, `npm test`, and `npm run test:browser -- e2e/image-visibility.spec.js e2e/background-display-options.spec.js e2e/dashboard-home.spec.js e2e/settings-scope.spec.js`. Report missing browser prerequisites rather than installing system packages.

## Acceptance Criteria

- Images offers desktop/mobile visibility and fullscreen hiding in the same pattern as other items, with no duplicate general toggle.
- At widths up to 600px, mobile visibility applies independently; above 600px, desktop visibility applies. Fullscreen hiding overrides either profile only while fullscreen is active.
- Existing hidden-image preferences remain hidden on both profiles after upgrade. Explicit new preferences survive saving, reload, import/export, and scope changes.
- Hidden images never expose their blurred backdrop or filename. Widgets, background color, Settings access, playback selection, and saved layout geometry remain intact.
- Local changes remain private; Global changes reach only browsers using Global Images. Following Global playback does not override Local presentation.
- Focused browser tests, syntax checks, and unit tests pass, or environmental blockers are recorded.

## Risks And Decisions

- Interpret “like others” as desktop/mobile/fullscreen parity because a basic image toggle already exists. Do not create unrelated image selection or scaling features.
- Migration must inherit `imageVisible: false` for an absent mobile field; blindly defaulting mobile to true would reveal previously hidden photos.
- Fullscreen hiding is an override, not a saved profile mutation. Exiting fullscreen restores the active profile's saved visibility.
- Keep existing preference storage keys and transfer versions; use the established additive migration mechanism without weakening validation.
- This task creates a plan only. Do not modify implementation code or unrelated user changes, including `todo.md` and the deleted task 78 goal.
