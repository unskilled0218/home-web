# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Extend preferences and compatible reads](#1-extend-preferences-and-compatible-reads)
    - [2. Add category-owned scale controls](#2-add-category-owned-scale-controls)
    - [3. Apply independent presentation scales](#3-apply-independent-presentation-scales)
    - [4. Add regression coverage and verify](#4-add-regression-coverage-and-verify)
    - [5. Update documentation and release metadata](#5-update-documentation-and-release-metadata)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Add independent desktop/mobile display scales for Bookmarks, Home Assistant, and Wake-on-LAN, matching the existing Time/Weather/Calendar settings convention. Each category owns and saves its scales through its selected Local/Global store. Preserve saved layout geometry, visibility, selections, connections, device actions, and existing settings. This planning stage changes no implementation code.

## Implementation Plan

### Summary

`public/dashboard-helpers.js` currently defines and projects scales only for Time, Weather, and Calendar. The three remaining categories expose visibility controls but no scales. Extend the shared preference contract and category controls, apply presentation variables to the existing widget roots, and make their descendant text inherit those scales in Automatic and Custom layouts. Explicitly handle old persisted Local records: `readLocal()` currently uses strict `validateLocalSettings()`, so merely adding required preference keys would reject otherwise valid existing records.

### 1. Extend preferences and compatible reads

- Add six preference keys in `public/dashboard-helpers.js`: `bookmarksScale`, `mobileBookmarksScale`, `homeAssistantScale`, `mobileHomeAssistantScale`, `wolScale`, and `mobileWolScale`. Defaults are 1; valid saved values are finite numbers from 0.5 through 2 in 0.1 increments. Follow existing normalization conventions for desktop and mobile scales, while retaining strict canonical write validation.
- Extend `resolveDisplayPreferences()` with the three effective scales. At widths up to and including 600px use their mobile values; above 600px use desktop values. Neither profile falls back to the other profile's value.
- Extend `decodeStoredDashboardPreferences()` to default only absent new fields to 1, preserving explicit valid values and rejecting invalid present values. Preserve all existing legacy defaults and layout decoding. Server database and confirmed shared-cache reads already use this decoder; they must not write data or advance revisions merely to add defaults.
- Separate compatible Local reads from strict Local writes in `public/dashboard-settings-data.js` and `public/dashboard-settings-scope.js`. Add a stored-record decoder using the existing strict envelope/location/follow validation and a missing-new-scale-only preference upgrade, then route `readLocal()` through it, including rereads during admission and storage events. Keep `validateLocalSettings()` strict for newly constructed save records. Do not catch an upgrade failure and replace valid old preferences with defaults.
- Keep the version-1 transfer envelope and byte limits. At the shared `validateSettingsTransfer()` import boundary, default absent new scales to 1 before strict preference validation, allowing previously exported complete files to import without losing existing settings. Do not default unrelated required fields, accept unknown keys, normalize invalid present scales, or bypass revision checks. Exports emit all six canonical fields; server and browser transfer validation must agree.
- Keep live preference PUTs and snapshot validation strict and complete. Older open clients require reload rather than silently overwriting new fields. Do not add a database schema migration, new endpoint, or automatic storage rewrite.

### 2. Add category-owned scale controls

- Add the desktop/mobile pairs to the Bookmarks, Home Assistant, and Wake-on-LAN key lists in `public/dashboard-settings-categories.js`. Every new key must belong to exactly one category; General continues to own geometry and retained overall scale only.
- Add labeled desktop and mobile scale inputs to the corresponding panels in `public/index.html`, using `form="preferences"`, `type="number"`, `min="0.5"`, `max="2"`, and `step="0.1"`. Group them with the corresponding profile visibility controls using the existing Time/Weather/Calendar panel pattern; retain fullscreen-hiding and connection/device forms.
- Reuse category-driven fill, dirty tracking, validation, Save, Reload, and Local/Global token handling in `public/dashboard.js`. Do not introduce a second settings owner, live unsaved preview, automatic saves, or new controls in General or the layout editor.
- Verify saving one category carries both of its scale values and preserves its selections, all other categories, the opposite raw store, category scope choices, and both layout profiles. An invalid field in another category must not block the selected category's Save.

### 3. Apply independent presentation scales

- Add a small presentation-only helper in `public/dashboard.js` that sets `--bookmarks-scale`, `--home-assistant-scale`, and `--wol-scale` on `#bookmarks`, `#dashboard-ha`, and `#dashboard-wol` from effective display preferences. It must not call `startClock()`, provider configuration, or bookmark/device presentation controllers. Call it inside the existing `applyPresentation()` before the existing view refresh so startup and breakpoint transitions apply the correct profile values without changing their established lifecycle behavior.
- Route confirmed changes to all six new keys through a separate snapshot update path, not by adding them to the existing `applyPresentation()` trigger. When no existing presentation update is already running, apply the helper and then refresh layout/view measurements through `applyVisibilityLayout()`. This keeps scale-only saves, polling, storage events, and scope-driven effective-value updates immediate without clearing/recreating the clock timer. If an existing presentation change already invokes `applyPresentation()`, its helper call covers the new scales too.
- Preserve simultaneous-update behavior explicitly: changes to Time format/timezone, visibility, existing presentation fields, provider configuration, or sources must still execute their current required lifecycle work even when the same snapshot changes new scales. Do not insert a scale-only `else if` that suppresses the existing Time-format branch. Preserve startup, visibility, and breakpoint clock handling; the isolation guarantee applies to updates whose only effective changes are the new scales. This resolves plan-review W1 without a broad presentation refactor.
- Keep scale application independent of provider configuration and content selection. Scale-only changes must not restart bookmark/device controllers, refetch their content, reset clock/photo owners, send Wake packets, or replace existing actionable DOM unnecessarily. Existing source-change behavior remains authoritative.
- In `public/dashboard.css`, give each target root its own `1rem × widget scale` font size in both Automatic flow and the Custom stage. Do not apply one shared device-container scale: Home Assistant and Wake-on-LAN must remain independent. Do not extend the retained information-wide overall scale to these widgets; its existing scope remains unchanged.
- Audit descendant typography, including headings, status/error text, Home Assistant sensor readings and update timestamps, bookmark links/retry buttons, and Wake names/buttons. Convert the target widgets' fixed `rem` text sizes to appropriate inherited `em` sizes or explicitly scaled equivalents, preserving current scale-1 typography in each layout mode. Account for Home Assistant's nested `.85rem` reading rule and Custom status/headline overrides. Restrict changes to dashboard widgets, not Settings pickers or connection/device editors.
- Use font-based scaling and natural wrapping, not root transforms or CSS zoom. Keep dashboard column sizing, device row allocation, card bounds, padding policy, and Custom reference/fit geometry unchanged. Larger content may wrap or scroll inside existing bounds; controls must remain usable at 0.5 and 2.
- Preserve task 74's live Automatic editing contract: entering editing at any widget scale keeps pre-entry typography and frame alignment. Custom scaling changes presentation only; it never rewrites canonical positions, dimensions, or layer order. Do not modify the reference estimator, geometry schema, or measured-candidate algorithm.

### 4. Add regression coverage and verify

- Extend `test/dashboard.test.js` and `test/dashboard-display.test.js` for six defaults, normalization, 0.1-step canonical validation, independent profile projection, labeled form controls, and default typography/style contracts where applicable. Reject missing fields on current writes, strings, null, nonfinite values, out-of-range values, and noncanonical fractional increments.
- Extend `test/dashboard-settings-api.test.js`, `test/dashboard-settings-sync.test.js`, `test/dashboard-settings-scope.test.js`, and `test/dashboard-settings-transfer.test.js` for upgrade reads of old database/cache/Local/transfer records missing the six fields. Assert defaults of 1, unchanged raw storage and revisions on read, preservation of all existing preferences/location/follow flags, explicit scale persistence after Save/restart, strict invalid-present rejection, old-transfer import defaults, and current export round trips. Test partial absence as well as all six fields absent; retain existing size limits and strict unrelated-field checks.
- Extend `test/dashboard-settings-categories.test.js` and scope tests to prove exactly-once key ownership, category-only patches, mixed Local/Global scale projection, offline Local saves, stale-token rejection, storage-event refresh, and preservation of other categories and layout geometry. Use distinct scales per widget/profile/store so accidental shared values cannot pass.
- Add parameterized browser cases in existing display/scope specs or a focused widget-scale spec. Use deterministic populated bookmark and Home Assistant fixtures plus a saved Wake device, without real integration credentials or packets. Verify actual computed sizes for links, sensor readings, names, headings, status/retry text, and Wake buttons, not merely input values or CSS-variable assignment.
- Exercise desktop above 1000px, intermediate stacked desktop, and mobile at/below 600px, including a 600/601 breakpoint transition. Verify scale-1 compatibility, distinct desktop/mobile values, min/max scales, wrapping/scroll access, no application before Save, cancel/discard behavior, reload/restart persistence, scope switching, remote confirmation, and no unrelated widget or raw-store changes.
- Cover Automatic, saved Custom, and active Automatic editing at nondefault scales. Assert Custom rectangles/layers and persisted `widgetLayout` remain unchanged after scale saves; allow normal Automatic flow changes after a saved scale change, but assert entering pristine editing introduces no additional rearrangement. Retain hidden/fullscreen behavior and verify Settings/editor chrome is not scaled.
- Add an ownership regression for each new widget's scale-only Local save and confirmed Global update. Instrument clock interval creation/clearing and retain the active interval identity, using `e2e/dashboard-layout.spec.js:742-752` as a starting point; assert no new/replaced clock interval, no photo-player restart, and no scale-triggered provider configuration/read or Wake action. Separate routine polling from scale-triggered work in request assertions. Include a real Time-format or visibility change as a positive control, and a combined Time-plus-new-scale snapshot that both applies the scale and performs the expected Time lifecycle work. Font-size, preference, or network assertions alone do not prove clock ownership is preserved.
- Run focused preference/display/category/scope/sync/transfer and layout tests, then `npm run check` and `npm test -- --test-concurrency=1` sequentially. Run relevant browser specs, then `npm run test:browser` with enough time for the complete suite. Chromium and Firefox were installed and verified during task 74; if prerequisites are missing again, report the exact install command and blocker instead of claiming runtime success. Finish with `git diff --check` and record results in `4-implemented.md`.

### 5. Update documentation and release metadata

- Update `docs/dashboard.md`, `docs/settings-scope.md`, and relevant `docs/dashboard-layout.md` wording to describe independent desktop/mobile scales for all six widgets, per-category ownership, unchanged Custom geometry, and preservation of old values. Update `docs/settings-import-export.md` for additive old-file defaults if needed. Keep README changes brief and relevant.
- During implementation, advance version `0.17.43` to `0.17.44` if still current. Synchronize `VERSION`, package/root lock versions, README, versioned release notes, `scripts/release.json`, and the release link in `docs/releases.md`. Do not push, publish, or deploy as part of implementation.

## Acceptance Criteria

- Bookmarks, Home Assistant, and Wake-on-LAN each expose independent desktop/mobile scale controls from 0.5 to 2 in 0.1 steps, defaulting to 1.
- Saved values visibly scale each widget's content, including sensor readings and actionable labels, in Automatic and Custom modes without scaling Settings or editing chrome.
- Mobile uses only mobile scale values at widths up to and including 600px. Desktop uses only desktop values above 600px; changing one widget does not scale another.
- Scale changes follow their category's Local/Global scope, apply only after Save/confirmed updates, survive reload/restart, and preserve unrelated settings, selections, stores, and geometry.
- Existing database, shared-cache, Local, legacy, and previously exported complete records remain readable/importable with absent new scales defaulted to 1. Compatible reads perform no writes; malformed present values still fail strict validation at the relevant boundary.
- Custom geometry/layers, live Automatic editor entry fidelity, visibility/fullscreen rules, and existing provider/action ownership remain intact. Scale-only Local saves and Global confirmations preserve the active clock interval and photo owner and do not initiate provider reconfiguration or Wake actions. Combined Time-and-scale changes still perform required Time lifecycle updates and apply the new scales.
- Relevant Node/browser verification passes, and documentation/version metadata accurately describe the feature and compatibility behavior.

## Risks And Decisions

- Adding preference keys changes an exact-field contract. Old Local records use strict validation today and would otherwise fall back to an empty preview. Upgrade only at explicit stored/import boundaries; retain strict current writes and do not erase existing records.
- A root font size alone will miss fixed-rem headings, nested sensor readings, and retry labels. Test representative populated descendants in both DOM placements rather than relying on root computed style alone.
- Scaling means content typography and its natural wrapping, consistent with existing per-widget controls, not scaling saved widget rectangles or changing global dashboard layout dimensions. Custom card overflow remains accessible through its existing scrolling behavior.
- At scale 1, existing Automatic and Custom typography may differ intentionally. Preserve each mode's existing appearance rather than normalizing unrelated styles while adding scale support.
- The retained overall scale belongs to the existing information widgets; this task must not unexpectedly apply it to Bookmarks or devices. Each new widget scale composes only with the existing Custom canvas fit.
- `applyPresentation()` currently calls `startClock()` unconditionally, so routing new scale-only changes through it would violate ownership isolation. Keep new snapshot scale updates on the dedicated CSS/view path, while reusing the helper within existing startup/breakpoint presentation work. Timer-identity regressions and combined-update positive controls are required to address review W1.
- Prior integration-draft discard and Calendar auto-close warnings remain outside this task. Do not bundle connection-flow fixes, layout redesigns, or general refactoring into scale support.
