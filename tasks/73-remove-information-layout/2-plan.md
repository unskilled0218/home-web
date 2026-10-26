# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Remove the controls and update General guidance](#1-remove-the-controls-and-update-general-guidance)
    - [2. Preserve stored preferences and layout behavior](#2-preserve-stored-preferences-and-layout-behavior)
    - [3. Update regression coverage without weakening it](#3-update-regression-coverage-without-weakening-it)
    - [4. Update documentation and release metadata](#4-update-documentation-and-release-metadata)
    - [5. Verify and record results](#5-verify-and-record-results)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Remove the Information layout section and its Position and Overall scale controls from Settings > General. Preserve saved Local and Global values, their existing presentation effects, General scope, Global transfers, corrupt-map recovery, and direct dashboard layout editing. Do not move the removed controls to another panel or introduce replacement controls. This planning stage changes no implementation code.

## Implementation Plan

### Summary

Make a focused markup and documentation change while retaining the existing preference contract. Update tests that currently use Position or Overall scale as convenient editable fields; continue testing drafts, validation, conflicts, synchronization, and layout preservation with controls that remain available.

### 1. Remove the controls and update General guidance

- In `public/index.html`, remove the complete `Information layout` fieldset, including the `position` select and `scale` input. Do not retain hidden replacement inputs or relocate them.
- Replace General's description, which currently advertises position/scale and widget visibility, with accurate guidance about its category scope, Global transfers, recovery, and layout editing from the dashboard.
- Keep General as the initial accessible tab. Preserve its dynamically inserted scope selector, transfer controls, recovery controls, and the existing category footer behavior. Do not remove General Save/Reload as an unrelated UI redesign.

### 2. Preserve stored preferences and layout behavior

- Retain `position` and `scale` in canonical defaults, validation, Local records, Global records, transfer files, and General ownership in `public/dashboard-settings-categories.js`. No storage migration, deletion, normalization reset, or API schema change is needed.
- Confirm `fillCategory` and `readPreferenceDraft` in `public/dashboard.js` work when General has no ordinary preference inputs. The current draft reader starts from the captured baseline and overlays only present controls, so absent Position/Overall scale controls must preserve saved values rather than apply defaults. Change production JavaScript only if a demonstrated assumption requires it.
- Preserve `widgetLayout`, the General-bound layout save adapter, source/revision admission, and the layout session's use of saved `position` for Automatic profiles. Do not change scale projection, Automatic/Custom behavior, geometry, layers, or layout editor controls.
- Keep rendering saved position/scale values as before, including the existing mobile projection rules. Removing their form controls does not mean removing their stored or runtime semantics.

### 3. Update regression coverage without weakening it

- In `test/dashboard.test.js`, replace positive assertions for Information layout/Position/Overall scale with absence assertions. Update the form ownership test to exclude `position` and `scale` from the expected editable inputs while preserving the remaining schema and service-form assertions. Check that General transfer/recovery markup and the direct layout editor remain present.
- Add focused preservation tests using nondefault `position`, `scale`, and nonempty Desktop/Mobile layouts in both Local and Global raw stores. Verify General saves with no visible preference changes preserve those values, another category's save preserves them, and a direct layout save changes only `widgetLayout`. Existing policy tests must continue requiring complete/disjoint ownership, including these retained keys.
- Add a browser scenario that verifies the removed section and both controls are absent, General scope/transfers remain usable, and saved nondefault values survive opening/reloading/saving General. Verify a direct layout edit still saves to General's selected store without resetting position/scale or copying other categories from a mixed projection.
- Update affected browser files: `e2e/dashboard-home.spec.js`, `e2e/global-settings.spec.js`, `e2e/dashboard-layout.spec.js`, `e2e/global-settings-transfer.spec.js`, `e2e/integration-settings.spec.js`, `e2e/dashboard-devices.spec.js`, and `e2e/settings-scope.spec.js`.
- Use retained Time or Weather scale/format controls for ordinary dirty-draft, invalid-input, cross-tab, conflict, integration-isolation, and cross-browser tests. Select and save the owning category explicitly; update expected keys and messages accordingly. For cross-category validation, use invalid Time timezone and invalid Weather scale rather than removed General scale.
- In transfer tests, use a dirty retained category such as Time to assert that import is disabled; test that category's dirty scope guard rather than fabricating a General form field. General must remain Global for the import setup.
- Where an existing test needs nondefault legacy Position/Overall scale presentation, seed the raw preference fixture before navigation rather than interacting with deleted controls. Keep assertions that those saved values still affect presentation.
- For layout preservation/conflict scenarios, use a retained category's actual preference save and assert its full Global request preserves the confirmed remote layouts and legacy values. Keep General-specific geometry/conflict coverage through the direct layout editor. Do not delete entire scenarios, loosen assertions to unconditional success, or restore removed inputs just to satisfy tests.

### 4. Update documentation and release metadata

- Update `docs/dashboard.md` so General no longer advertises layout/scale form controls. Clarify that direct layout editing remains available from the dashboard and existing stored position/scale values remain supported.
- Review `docs/settings-scope.md` and `docs/dashboard-layout.md` for conflicting wording. Preserve the distinction between General's stored ownership and its visible controls; do not claim position/scale were removed from schemas or exports. Update README only if its current text needs correction, keeping it brief. Do not rewrite archived task documents.
- Follow the current patch-release convention during implementation: advance `0.17.41` to `0.17.42` if still current, synchronizing `VERSION`, npm manifest/root lock versions, README version, `scripts/release.json` notes path, and `docs/releases.md`; add the matching release notes with a table of contents. Do not publish, deploy, or push as part of implementation unless separately requested.

### 5. Verify and record results

- Run focused Node tests for dashboard markup, category policy, scope coordination, and layout sessions, followed sequentially by `npm run check` and `npm test -- --test-concurrency=1`.
- Run focused browser specs for the affected settings, transfers, integrations, and layout scenarios, then `npm run test:browser`. Do not run Node/browser verification concurrently because earlier tasks recorded native child-process instability under concurrent verification.
- Browser executables were missing during task 72's review: Chromium headless shell was absent, and the earlier implementation report also recorded missing Firefox. Check the current environment rather than assuming either suite passes. Do not install browser/system packages; report missing prerequisites and the relevant `npx playwright install chromium` or `npx playwright install firefox` command for the user.
- Search active source/tests/docs for obsolete interactive uses of Information layout, Position, and Overall scale; distinguish legitimate schema/rendering references and compatibility tests from stale UI expectations. Run `git diff --check` and record verification results and limitations in `4-implemented.md`.

## Acceptance Criteria

- Settings > General contains neither the Information layout section nor its Position/Overall scale controls; they are not recreated elsewhere or as hidden inputs.
- General remains the initial accessible tab with its scope selector, Global import/export, recovery, and existing footer behavior intact.
- Existing Local/Global `position`, `scale`, and both layout profiles remain supported and unchanged by reads, scope changes, ordinary category saves, and no-change General saves. Existing deliberate import replacement behavior remains unchanged.
- Direct layout editing still works through General scope and saves only the layout patch, preserving non-layout preferences and mixed-store isolation.
- Tests no longer interact with removed controls, but retain equivalent validation, draft, conflict, synchronization, integration, import-gating, and layout coverage.
- Documentation reflects the reduced General UI, release metadata agrees, and verification results distinguish passing checks from blocked browser runs.

## Risks And Decisions

- Treat this as removal of form controls, not removal of legacy preference fields or their presentation effects. Keeping the fields avoids breaking saved records, exports, and Automatic layout initialization.
- General will have no ordinary editable preference inputs in Settings, but it still owns stored layout data and gates Global import. Keep its existing category actions for this task rather than expanding scope into a footer redesign.
- Many browser tests use Overall scale as a generic dirty field. Replacing it requires changing the active category and assertions, not merely substituting a selector.
- Preserve category-aware save baselines so omitted inputs do not silently reset legacy fields. Add regression coverage before considering broader serializer changes.
- The two task 72 review warnings concerning integration draft discard and Calendar connection auto-close remain outside this request. Do not silently fix those behaviors while migrating tests.
