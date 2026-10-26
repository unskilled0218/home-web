# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Remove only General's scope control](#1-remove-only-generals-scope-control)
    - [2. Preserve existing layout ownership](#2-preserve-existing-layout-ownership)
    - [3. Make Global transfer independent of General's selector](#3-make-global-transfer-independent-of-generals-selector)
    - [4. Add regression coverage and verify](#4-add-regression-coverage-and-verify)
    - [5. Update documentation and release metadata](#5-update-documentation-and-release-metadata)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Remove the Local/Global selector from Settings → General while retaining the seven widget categories' selectors, existing saved settings, working layout editing, and usable Global import/export. This is a UI simplification, not removal of either backing store or a migration of saved layout ownership. This planning stage changes no implementation code.

## Implementation Plan

### Summary

`public/dashboard-category-controls.js` generates a selector for every `CATEGORY_IDS` entry and assumes each has an update target. General owns `position`, `scale`, and `widgetLayout` internally even though its panel no longer has those preference inputs. Its stored scope also gates imports through `getTransferState()` and `importGlobal()` in `public/dashboard-settings-scope.js`. Simply hiding the select would strand fresh Local users with disabled imports. Remove General from control generation, preserve its existing internal layout-storage policy, and admit explicit Global transfers independently of that policy while retaining revision and draft protection.

### 1. Remove only General's scope control

- In `public/dashboard-category-controls.js`, generate selectors for the seven non-General categories only. Keep `CATEGORY_IDS`, `SETTINGS_CATEGORIES`, complete preference ownership, and the eight-entry persisted scope schema unchanged. Use an explicit UI-only category filter rather than redefining domain categories to match visible controls.
- Make `update('general', state)` a deliberate no-op or update only the generated controls from the caller. `renderSettingsState()` currently iterates all eight categories; removing a DOM element must not introduce an undefined-control error during startup, saves, polling, or scope recovery.
- Remove the General scope fieldset and its explanatory status by not creating them, rather than hiding a still-focusable control. Do not replace it with another Local/Global switch elsewhere.
- Update General's description in `public/index.html`: it contains Global transfer and scope recovery, with layout arrangement available through Edit layout. Remove instructions to choose General scope. Retain the transfer section, recovery controls, tab accessibility, and other panels' controls.
- Do not remove existing layout ownership/status feedback in the editor merely because the selector disappears. Retained internal state is not a new General control.

### 2. Preserve existing layout ownership

- Leave General's category keys, effective preference composition, existing `general` scope-map entry, legacy seeding, and fresh-profile Local default intact. Existing Local layouts remain Local; existing Global layouts remain Global. Do not rewrite scope maps or copy preferences between stores on startup or Settings open.
- Keep direct editing wired through `getCategoryState('general')` and `saveCategory('general', ...)` in `public/dashboard.js`. Preserve both Desktop/Mobile profiles, retained position/overall scale, captured revisions, conflicts, offline Local saves, and the opposite raw store.
- Keep handling storage events from older tabs or persisted General mode changes safely, even though the new UI cannot change that mode. Existing stale-draft/source guards and gesture cancellation still apply. Keep the explicit corrupt-map recovery flow; it is not replaced by silent migration.
- Do not add a fixed Global mode, force Local on existing profiles, infer layout ownership from another category, or expose a new layout-store selector. If the desired product policy is to eliminate General's internal scope entirely, that requires a separate decision about which saved layout wins; it is not assumed here.

### 3. Make Global transfer independent of General's selector

- In `public/dashboard-settings-scope.js`, separate transfer admission from General's category mode and Local revision. `getTransferState()` must describe raw Global transfer authority, not inherit `general.mode`, `general.source`, or its Local save token. Keep category mutation admission unchanged for ordinary preference, layout, and integration actions.
- Add an explicit coordinator-owned transfer preparation method used after a valid file is selected and on explicit retry/reload. Obtain a fresh validated `/api/dashboard/settings` snapshot containing raw Global preference revision and `integrations.weather.revision`, including when every category is Local. Reuse/coalesce the existing shared reader when it is active; otherwise use a bounded, cancellable one-shot read. An invisible `createSettingsSync.refresh()` currently returns without reading, so merely calling it is not sufficient for all-Local clients.
- Keep preparation read-only: do not change the category map, create server preference rows, apply Global preferences/city to Local categories, start provider work, or start permanent Global preference polling on all-Local pages. Transfer preparation is user-triggered, not an unconditional Settings-open request. Export continues using the existing read-only export endpoint, which returns the settings file without revision metadata and therefore cannot itself prepare import revisions.
- Keep one transfer baseline containing the two raw Global revisions and an opaque generation/admission token. It must not be invalidated merely by a Local General revision change. Reconcile and validate the persisted category map before preparation and immediately before dispatch; reject unreadable/corrupt maps and a changed captured map rather than using a stale admission. Check disposal, current preparation generation, pending Global preference writes/imports, and integration actions before sending. Do not bypass these guards just by deleting `globalOnly: true`.
- In `public/dashboard-settings-transfer.js`, remove the `state.mode !== 'global'` enablement condition. Enable import only after file validation, confirmed transfer preparation, valid raw revisions, no scope errors, no conflicting work, and the existing `canImport()` draft/editor guard. File selection still performs no writes. The button explicitly says Import global settings; it does not import into the current mixed projection or whichever store owns layout editing.
- Preserve selection/generation ownership across asynchronous file reads and preparation. A replacement file, disposed controls, or superseded preparation must not enable import with late data. Report preparation failures and retain the selected file for explicit retry/reload. Do not silently rebase captured revisions during a poll or immediately before a stale import; the server must still reject intervening preference or weather changes with 409.
- Continue posting the same version-1 transfer and two expected revisions to the existing import endpoint. Keep byte limits, exact validation, transaction semantics, failure/timeout reporting, and explicit reload/retry after conflicts. Validate the committed response before adoption and publish it through the existing shared-state path, without applying Global values to Local categories or changing their maps. All-Local clients must not gain a lasting poll timer after adoption.
- Preserve existing concurrency policy: imports block competing Global preference/layout writes, while unrelated Local saves remain possible. Keep `canImport()` protection for all display, layout, Calendar, Linkwarden, Home Assistant, and Wake drafts. Do not weaken server host/origin checks or integration-category Global requirements.

### 4. Add regression coverage and verify

- Add focused control-rendering coverage proving General creates no select or scope status, the other seven categories retain their labeled controls, and repeated updates including General do not throw. Keep the eight-category canonical ownership and strict scope-map tests unchanged in meaning; UI control count is seven, storage ownership count remains eight.
- Extend `test/dashboard-settings-scope.test.js` for import preparation/admission with General Local, General Global, fresh all-Local profiles, and mixed scopes. Verify exact raw Global revisions, no preparation writes, no Local projection/location adoption, no lasting all-Local Global poll owner, unchanged raw Local records/maps, and no dependence on Local General revision.
- Test preparation failures, malformed snapshots, invalid/corrupt/unreadable maps, persisted map changes before delayed storage events, stale preference and weather revisions, duplicate import admission, pending Global writes/actions, disposal, superseded file/preparation completions, and post-import committed-state adoption. Keep conflict paths non-mutating; retain selected files/drafts and require explicit rebase. Preserve ordinary Local saves during unrelated Global work.
- Extend transfer control tests using existing DOM test patterns or a focused test file to cover enablement without a General selector, file-only read behavior, generation guards, explicit retry/reload, dirty-category/editor blocking, and failure recovery. Retain existing server transfer/API tests for exact schema, two-component transactions, byte limits, and revision conflicts.
- Update `e2e/settings-scope.spec.js` to assert General selector absence while testing seven remaining selectors. Replace calls that toggle General through the UI with separate contexts seeded with saved Local/Global General maps, keeping existing layout save isolation, default preservation, and legacy-mode tests. Do not replace removed UI interactions with a helper that silently changes production storage during a test workflow.
- Update `e2e/global-settings-transfer.spec.js` so a fresh all-Local browser imports successfully without switching General. Retain export/download round trips, independent Global peers, unchanged Local records and category choices, Local follower behavior, malformed/oversized/stale files, and dirty-draft protection. Cover preparation unavailable/offline states and a weather-only revision conflict as well as preference conflicts.
- Search active source, test fixtures, browser helpers, and current docs for `settings-scope-general`, `setCategoryScope(..., 'general', ...)`, and General-Global import instructions. Update only assumptions affected by removal; do not rewrite archived task documents. Browser tests for all-Local transfer must observe network/timer ownership rather than only the button's enabled state.
- Verify General and all remaining selectors are usable at desktop and 390px mobile widths, keyboard tab order has no phantom General scope control, Edit layout still works for both saved ownership modes, and importing never changes layout backing ownership. Retain task 74/75 geometry, scale, clock/photo ownership, and Custom/Automatic regressions.
- Run focused category/scope/sync/transfer/layout Node tests, then `npm run check` and `npm test -- --test-concurrency=1` sequentially. Run `e2e/settings-scope.spec.js`, `e2e/global-settings-transfer.spec.js`, `e2e/dashboard-layout.spec.js`, and `e2e/widget-scales.spec.js`, then the full `npm run test:browser` with sufficient timeout. If browser prerequisites are unavailable, report the exact install command rather than installing system packages. Record actual verification and limitations in `4-implemented.md`; finish with `git diff --check`.

### 5. Update documentation and release metadata

- Update `docs/settings-scope.md`, `docs/settings-import-export.md`, `docs/dashboard.md`, and relevant `docs/dashboard-layout.md` wording. Describe seven visible category selectors, preserved saved layout ownership/defaults, and explicit Global imports independent of General's mode. Explain file preparation, stale revisions, unchanged Local data/maps, and explicit retry/reload. Do not describe General's removed selector as an available workflow.
- Keep README changes brief. During implementation, advance `0.17.44` to `0.17.45` if still current and synchronize `VERSION`, package/root lock versions, README, versioned release notes, `scripts/release.json`, and the release link. No push, deployment, or release publication is part of implementation.

## Acceptance Criteria

- General has no Local/Global selector or generated scope fieldset; all seven other categories retain their current independent selectors and saving behavior.
- Startup, Settings updates, polling, and recovery do not fail because General has no generated control. General still provides usable transfer and recovery controls.
- Existing scope maps, Local/Global preferences, and saved layouts are preserved without read-time migration writes. Fresh layout ownership remains Local; existing saved Global ownership remains Global. Direct edits retain current revision/conflict and opposite-store isolation guarantees.
- A fresh all-Local browser can explicitly export/import Global settings without switching General or another category. File selection/preparation is read-only; actual import targets raw Global values and preserves Local records, follow choices, and category maps.
- Transfer preparation confirms both raw Global revisions without permanent all-Local preference polling. Imports reject stale revisions and invalid admissions, preserve files/drafts on failure, and cannot be enabled by late obsolete preparation results.
- Existing draft/action guards, Global write exclusion, Local-save independence, transfer limits, server transaction semantics, and integration-category requirements remain intact.
- Node and browser regressions pass, and documentation accurately states the removed UI and retained compatibility policy.

## Risks And Decisions

- Interpretation: remove General's visible scope choice, not its persisted layout ownership. Forcing a single backing store would change saved behavior and require a migration/winner policy not requested in `1-goal.md`. The retained compatibility entry is intentionally not user-switchable in the new UI.
- The current import guard depends on General Global. Removing only markup would leave default users unable to import. Transfer-specific raw Global authority is necessary to keep the goal's transfer functionality without inventing a replacement selector.
- All-Local clients currently do not own an active Global preference reader, and hidden sync refreshes do nothing. Import preparation must handle that state explicitly without converting a transfer into continuous synchronization or replacing Local presentation.
- Scope is a client-side ownership policy, not server authorization. Making the explicitly Global import action independent of General's selector must preserve request and revision protections, not introduce a new security model.
- Removing one visible control must not reduce the persisted schema to seven entries, delete General's preference keys, reset legacy maps, or rewrite both layout profiles. Existing eight-category tests remain valuable even though visible control counts change.
- Preserve conflict semantics rather than silently refreshing revisions during import. A failed or timed-out write can have an uncertain server outcome; retry must follow a deliberate fresh read.
- Historical General-mode strings in archived reports are retained. Unrelated connection-draft discard, Calendar auto-close, layout redesign, and broader settings refactoring remain outside scope.
