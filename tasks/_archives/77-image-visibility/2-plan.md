# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Add a backward-compatible Images preference](#1-add-a-backward-compatible-images-preference)
    - [2. Add the Images settings control](#2-add-the-images-settings-control)
    - [3. Project image visibility without changing playback](#3-project-image-visibility-without-changing-playback)
    - [4. Add regression coverage and documentation](#4-add-regression-coverage-and-documentation)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Add a saved option to show or hide dashboard background images without changing other dashboard content. Include the foreground photo, blurred image backdrop, and filename caption. Use the existing Images category's Local/Global scope. Do not add mobile-specific or fullscreen-specific settings, change NFS configuration, or change slideshow selection and rotation.

## Implementation Plan

### Summary

Introduce an `imageVisible` boolean defaulting to `true`, expose a “Show image” checkbox, and apply visibility through the existing pure display projection. Hidden images reveal the saved solid background color while widgets remain unchanged.

### 1. Add a backward-compatible Images preference

- Add `imageVisible: boolean(value.imageVisible, true)` to `normalizeSettings` in `public/dashboard-helpers.js`; `PREFERENCE_KEYS` will include it automatically.
- Add `imageVisible` to the Images keys in `public/dashboard-settings-categories.js` so composition, scoped saves, drafts, and conflicts use the existing category mechanisms.
- Extend `decodeStoredDashboardPreferences` and the additive compatibility decoder currently named `decodeWidgetScalePreferences` to supply `imageVisible: true` only when the field is absent. Preserve explicit `false` and reject invalid provided values.
- Cover stored server preferences, saved Local records, legacy localStorage preferences, and version-1 settings imports. Reuse the existing additive compatibility path rather than loosening strict validation for current API writes or inventing another schema version.
- Keep current snapshots and save payloads canonical and complete. Do not change the SQLite schema or reset saved preferences.

### 2. Add the Images settings control

- Add an accessible checkbox named `imageVisible`, labeled “Show image”, in `public/index.html` within the Images panel.
- Use the existing `preferences` form association and generic category fill/read/save logic in `public/dashboard.js`; do not create a separate storage key or save flow.
- Add brief help text explaining that hiding images retains the background color and does not hide widgets. Keep “Show filename” and “Show the same image as Global” as separate options.
- Apply the value only after the existing category Save action. Preserve unsaved drafts and existing Local/Global category-switch protections.

### 3. Project image visibility without changing playback

- Extend `dashboardDisplay` in `public/dashboard-display.js` with image and caption visibility. A caption contributes to information/content layout only when `imageVisible` is enabled and caption text exists.
- Extend `applyDashboardDisplay` to toggle `#photos` and `#photo-caption` using the existing `[hidden]` CSS rule. Hiding `#photos` must hide every foreground, blur layer, and active transition immediately.
- Update `public/dashboard.js` so a saved `imageVisible` change reapplies visibility even when no other presentation field changes. Keep `applyVisibilityLayout` as the shared path for settings changes and asynchronous photo callbacks.
- Keep the existing `document.body.style.backgroundColor = settings.color` behavior. Solid color remains visible when images are hidden, including when the selected backdrop mode is blur.
- Continue updating photo layers and caption text internally while hidden; the display projection must prevent asynchronous `show` and `update` callbacks from revealing either. Showing images again reveals the current selection without resetting its order, interval, or source.
- Leave `public/dashboard-photo-scope.js`, shared/local photo controllers, tab visibility handling, and server slideshow behavior unchanged unless tests expose an integration requirement. Image visibility is presentation, not an NFS or playback switch.
- Ensure caption handling in `public/dashboard-layout-view.js` respects the new projected visibility in both automatic and custom layouts. Do not alter widget geometry or widget visibility settings.

### 4. Add regression coverage and documentation

- Extend `test/dashboard.test.js` and preference/API tests to cover default `true`, explicit `false`, invalid boolean values, and migration of older persisted records without losing unrelated values.
- Extend `test/dashboard-settings-categories.test.js`, `test/dashboard-settings-scope.test.js`, and `test/dashboard-settings-transfer.test.js` to cover Images ownership, independent Local values, Global propagation, and old/new import-export round trips. Test that unknown or malformed fields remain rejected.
- Extend `test/dashboard-display.test.js` and relevant layout-view tests for hidden photos, hidden captions, caption-only layouts, unchanged widget visibility, and restoring caption visibility.
- Add browser tests using the real image fixtures in `e2e/photo-display-recovery.spec.js` or a focused `e2e/image-visibility.spec.js`. Cover saving hide/show, persistence after reload, solid and blur backdrops, filename enabled, and hidden-state rotation or delayed image completion.
- Exercise Local following Global, independent Local playback, and Global Images settings. Verify Local hiding does not change server preferences or another browser; verify Global hiding reaches browsers using Global Images.
- Include mobile, fullscreen, and custom-layout checks; assert widgets and settings access remain usable and that showing images restores real decoded image bytes.
- Update `docs/dashboard.md` and, where needed, `docs/settings-scope.md` and `docs/settings-import-export.md` to describe the option, scope, default, and presentation-only behavior. Keep their tables of contents accurate.
- Run `npm run check`, `npm test`, and `npm run test:browser` with the project's required Node.js version (24 or newer). Record any environment blockers rather than changing dependencies or installing system packages.

## Acceptance Criteria

- Images settings include a saved “Show image” option enabled by default.
- Disabling it hides foreground photos, blurred photo backdrops, active photo transitions, and filenames, leaving the saved solid background color visible.
- Clock, weather, calendar, bookmarks, Home Assistant, Wake-on-LAN, and their layout preferences remain unchanged.
- The choice survives reload and follows the existing Images Local/Global scope. Local visibility remains independent even when following Global's image selection.
- Re-enabling the option displays the current slideshow image and restores the filename when enabled, without resetting playback settings.
- Photo completion, rotation, settings synchronization, viewport changes, fullscreen changes, and page lifecycle events cannot reveal an image or filename while the saved option is off.
- Existing saved settings and older exports without `imageVisible` load as visible; new exports preserve either boolean value.
- Targeted regression tests and the existing validation suites pass, or documented environment blockers explain unavailable checks.

## Risks And Decisions

- This is a presentation-only option. Photo fetching, preloading, and rotation continue while hidden; pausing playback or reducing network usage is outside this task.
- Missing fields in persisted data and imports need additive migration because preference validation requires an exact field set. Do not normalize malformed current requests into valid data.
- Caption text affects automatic layout calculations. Hiding only the photo container would leave filename text or empty layout space; visibility projection must cover both.
- Hide the entire photo container rather than changing opacity. Opacity alone would conflate visibility with an existing preference and could leave the blurred backdrop or caption exposed.
- Global image visibility must not disable the server's shared slideshow: Local dashboards can still follow its selection while choosing their own presentation.
