# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Resolve visibility for the editing profile](#1-resolve-visibility-for-the-editing-profile)
    - [2. Filter editor surfaces and reconcile selection](#2-filter-editor-surfaces-and-reconcile-selection)
    - [3. Keep actions and layer ordering consistent](#3-keep-actions-and-layer-ordering-consistent)
    - [4. Test and document](#4-test-and-document)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Hide visibility-disabled widgets from Edit layout frames, the widget selector, and layer controls. Preserve their stored layout entries so showing them again restores their geometry. Apply to the existing six layout widgets: Time, Weather, Calendar, Bookmarks, Home Assistant, and Wake-on-LAN. Do not turn photos into a layout widget or change dashboard visibility settings.

## Implementation Plan

### Summary

`public/dashboard-layout-editor.js` creates controls for all six widgets and labels hidden ones instead of excluding them. Automatic frames already omit missing live measurements, but Custom frames, selector options, and layer rows still expose hidden widgets. The layout schema requires all six entries, so filtering must affect editor presentation and actions, not persisted data.

### 1. Resolve visibility for the editing profile

- Reuse `dashboardDisplay()` from `public/dashboard-display.js` to derive enabled widget IDs from current effective preferences, `session.mode`, and the actual fullscreen state. Map layout ID `home-assistant` to display key `homeAssistantVisible`; keep this mapping in one small tested helper rather than duplicating visibility rules across controls.
- Use `getState().snapshot.preferences`, which already contains composed category preferences, for visibility. Do not use only General's stored values or the session's captured geometry baseline.
- Desktop/Mobile eligibility follows the profile selected in the editor, even when inactive or pinned across a viewport change. Fullscreen hide preferences override either profile while fullscreen is active.
- Do not infer eligibility from `nodes[id].hidden`, pixel dimensions, overlap, missing integration content, or Automatic measurements. DOM visibility describes the current viewport, which can differ from the profile being edited.

### 2. Filter editor surfaces and reconcile selection

- In `public/dashboard-layout-editor.js`, use one ordered eligible-ID set for frames, selector options, and layer rows. Remove hidden-widget labels/placeholders from the editing UI and remove unavailable selector options rather than relying solely on browser rendering of hidden `<option>` elements.
- Preserve the existing Automatic measurement guard: an eligible widget without a live measured rectangle still has no live Automatic frame. Covered or tiny enabled widgets retain toolbar access; an inactive Automatic profile retains its existing template behavior.
- Keep a selected widget if eligible; otherwise select the first eligible item in the effective layout order. Default entry, long-press entry, profile changes, Reload, and visibility updates must use the same rule.
- Support an empty selection when every widget is hidden. Show a short status explaining that no widgets are enabled for the selected profile and that visibility is changed in Settings after leaving the editor. Disable widget-specific geometry and layer controls, without disabling profile choice, Cancel, or other valid layout-level actions.
- Guard `announce()`, `render()`, `widgetPixels()`, validation, and selection-dependent actions against missing selections/items. No undefined-item projection or stale numeric values should occur in the empty state.
- Reconcile on render/observe and the existing fullscreen/surface refresh paths, including remote category updates while editing. If the selected widget becomes hidden, cancel its active gesture, release pointer capture, discard its uncommitted numeric text, and choose a valid replacement. Preserve completed layout drafts and captured save/source tokens; never silently rebase them.
- Move focus out of disappearing frames/rows to the replacement selector or toolbar toggle. Hidden controls must leave keyboard navigation and the accessibility tree.

### 3. Keep actions and layer ordering consistent

- Guard entry, selector changes, pointer gestures, numeric commits, and delegated layer actions against currently ineligible IDs, including deferred events from controls that were just hidden.
- Restrict layer commands to eligible widgets. Up/Down moves among visible neighbors; front/back moves among visible entries. Disable controls at visible-order boundaries and label positions as visible-layer positions, not a misleading six-widget count.
- Extend the layer operation in `public/dashboard-layout-session.js` / `public/dashboard-layout.js` with an explicit eligible-ID input or a focused helper. Preserve the existing unrestricted operation for callers that do not request filtering. Reorder only eligible entries through their existing array slots, leaving hidden entries and their geometry unchanged.
- Keep every Custom profile's six entries and both profiles' saved geometry intact. Do not filter `session.payload()`, loosen `normalizeWidgetLayout()`, add preference fields, or migrate stored records.
- Opening, filtering, switching profiles/fullscreen, and saving without edits must not materialize an Automatic profile or produce a write. Explicit edits/reset actions retain their existing Save/Cancel semantics and Local/Global ownership.

### 4. Test and document

- Extend `test/dashboard-layout-editor.test.js` and the visibility-helper tests for all six widget mappings, independent desktop/mobile flags, fullscreen overrides, fallback/empty selection, hidden options/rows/frames, focus recovery, and safe empty-state controls.
- Exercise remote visibility changes with selected raw input and an active gesture. Verify canceled gestures do not change geometry, deferred events cannot edit hidden widgets, and completed unrelated drafts/save tokens remain intact.
- Extend `test/dashboard-layout.test.js` and `test/dashboard-layout-session.test.js` for visible-only Up/Down/front/back, boundary no-ops, unchanged hidden slots and rectangles, six-entry validation, and unaffected inactive profiles.
- Update `e2e/dashboard-layout.spec.js` cases that currently require hidden placeholders, hidden-widget layer access, and all-hidden selector entries. Retain coverage for covered/tiny enabled widgets and zero-size canvases rather than conflating them with disabled visibility.
- Add browser cases for Automatic and Custom layouts, differing Desktop/Mobile flags while editing an inactive profile, pinned profiles across 600/601px, fullscreen entry/exit, all-hidden recovery, and visibility changes delivered from another browser. Check raw stored layouts before/after no-op Save, Cancel, actual edits, and re-enabling widgets after reload.
- Verify both Local and Global layout ownership with independently scoped widget visibility. Hiding/re-enabling widgets must not copy settings across stores or change their saved positions/sizes.
- Update `docs/dashboard-layout.md`, replacing the claim that hidden widgets remain selectable, and add a short relevant note in `README.md` / `docs/dashboard.md`. Follow the project's patch-version and release-note convention during implementation.
- Run `npm run check`, `npm test`, and `npm run test:browser -- e2e/dashboard-layout.spec.js e2e/background-display-options.spec.js e2e/settings-scope.spec.js e2e/image-visibility.spec.js`. Run `bash scripts/release.sh --validate` after updating release metadata. Report environmental or baseline failures separately; do not change unrelated weather code or dependencies.

## Acceptance Criteria

- A widget disabled for the selected editing profile has no editable frame, selector option, layer row, or actionable hidden-widget control, in Automatic and Custom layouts.
- Visibility uses the selected editing profile plus fullscreen override, not the viewport's DOM flags. Covered, tiny, and temporarily empty enabled widgets are not treated as visibility-disabled.
- Hiding the selection safely selects another eligible widget; hiding every widget produces a usable empty editor with no errors or unintended writes. Profile changes and exiting/canceling remain available.
- Visibility changes during gestures or raw input cannot commit edits to a newly hidden widget. Focus never remains trapped in a hidden control.
- Layer actions operate on visible widgets without altering hidden layout slots or rectangles. Saved Custom profiles still contain all six valid entries.
- No-op editing preserves Automatic profiles and stored bytes/revisions. Re-enabling widgets restores their previous geometry, and Cancel/Reload/conflict behavior and Local/Global isolation remain intact.
- Relevant checks pass, or unrelated baseline/environment failures are documented accurately.

## Risks And Decisions

- This deliberately changes the prior ability to select hidden widgets in the toolbar. Users must re-enable them in Settings before editing them; Settings remains unavailable until editing ends, as before.
- Filtering editor controls is separate from filtering saved data. Removing hidden items from Custom profiles would violate the schema and lose user layout information.
- Inactive-profile editing is the main correctness risk: current DOM visibility is not authoritative for the selected profile. Reuse shared projection instead of introducing a second visibility policy.
- Visible-only layer ordering must preserve hidden slots. Do not implement it by deleting hidden entries or repeatedly moving across them, which would unexpectedly reorder their saved layers.
- Do not broaden this task into layout-editor restructuring, photo visibility changes, review suggestion fixes from task 79, or unrelated user work. This planning stage changes no implementation code.
