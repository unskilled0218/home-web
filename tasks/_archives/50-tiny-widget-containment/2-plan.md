# Plan

## Table of Contents

- [Scope](#scope)
- [Current Boundaries](#current-boundaries)
- [Implementation Plan](#implementation-plan)
- [Acceptance Criteria](#acceptance-criteria)
- [Risks and Decisions](#risks-and-decisions)

## Scope

Fix only finding 2 in `tasks/49-stackable-dashboard-widgets/5-code-review.md`: custom widgets can exceed tiny projected rectangles because CSS padding imposes a larger physical box. Preserve the existing positive-surface fitting contract, including dimensions below 16px, and align preview decoration with that contract. Do not address finding 1 or redesign synchronization, persistence, coordinates, or minimum-size policy. This stage writes only this plan.

## Current Boundaries

- `public/dashboard-layout.js:39-44` already projects each widget into the available integer-pixel surface, reducing its 100px minimum per axis when necessary. Zero or nonfinite dimensions return `null`; projection never changes canonical geometry.
- `public/dashboard-layout-view.js:41-49` applies projected width/height and bottom-left coordinates to existing live nodes. Its Automatic-mode restoration at line 32 removes geometry properties; any added projection-only style properties must join that cleanup.
- `public/dashboard.css:202` applies fixed `.5rem` padding to all six custom cards. With border-box sizing, two 8px padding edges prevent a requested 10px height from becoming a 10px rendered box. Stage overflow merely clips the discrepancy.
- `public/dashboard-layout-editor.js:33-42` scales the same projected rectangles into the preview. Both `#layout-preview` and `.layout-preview-widget` currently have layout-affecting borders; a scaled card below 2px has its own border floor, and the frame border reduces the inner area relative to the assigned preview dimensions.
- `test/dashboard-layout.test.js` covers 40×60 surfaces but not one-pixel axes. `test/dashboard-layout-view.test.js` checks projection ownership and Automatic restoration using a fake DOM, which cannot expose CSS box-sizing defects.
- `e2e/dashboard-layout.spec.js` has real-server fixtures, viewport containment checks, 100px internal-scroll checks, and resize-without-write assertions. Its 160×150 case depends on tool/status wrapping and does not guarantee a surface below the padding floor.

## Implementation Plan

### 1. Establish task ownership and deterministic failing regressions

- During implementation, create branch `50-tiny-widget-containment` from the current task-bearing HEAD and create `4-implemented.md` with a table of contents. Preserve unrelated work and the historical task 49 review. Do not modify application files in this planning stage.
- Extend the existing layout browser spec with a narrowly scoped fixture that loads production markup, CSS, model, view, and editor in a real browser. Use either a test-only controlled `visualViewport` installed before the application starts, or an isolated document with the existing factory window arguments and a controlled viewport facade. Choose one approach, not two competing harnesses. Do not add a production global, measurement override, endpoint, or exported test-only method.
- For a controlled viewport, retain real DOM layout, computed styles, resize observers, and animation frames. Use an `EventTarget` for viewport events with explicit width, height, and zero offsets; derive those dimensions from known reserved margins/tool bounds so the measured usable surface is exactly the requested size. Keep the physical browser viewport large enough to inspect the Settings preview. Assert the resulting measured dimensions before checking containment.
- Cover positive surfaces such as 1×200, 10×200, 200×1, 200×10, 1×1, and 10×10, plus a normal surface. Include both profile selections and at least one scaled preview card below 2px. Assert against named widgets and report the actual surface/card rectangles on failure.
- Before fixes, demonstrate failures from actual live border boxes below 16px and preview border boxes below their border floor. Do not replace these assertions with model-only checks, clipping checks, or extra retries.

### 2. Make live card padding subordinate to projected dimensions

- In `public/dashboard-layout-view.js`, publish the already computed projected width/height as custom-card CSS variables, for example `--widget-width` and `--widget-height`, alongside the existing geometry assignment. These are derived presentation values, not new saved fields.
- In the custom-card CSS rule, bound horizontal and vertical padding independently using their respective projected dimension. A concrete policy is `min(.5rem, calc(var(--widget-width) / 4))` horizontally and the analogous height expression vertically. Each pair then consumes at most half its axis, keeps positive interior space, and retains existing `.5rem` padding for ordinary cards. Do not use vertical percentage padding, which resolves against containing-block width rather than card height.
- Keep custom card borders at zero and preserve `box-sizing: border-box`, zero minimum dimensions, absolute bottom-left positioning, overflow scrolling, content wrapping, and current stacking. Do not change Automatic-mode rules or enlarge the stage to conceal overflow.
- Remove the new variables when returning nodes to Automatic mode. Extend the fake-DOM view tests to check assignment, updates after resizing, and cleanup. Adjust fake style handling only if needed to accurately remove custom properties.
- Keep `projectWidget()` and canonical edit math unchanged unless a failing boundary test exposes an independent error necessary for this fix. Do not raise the minimum, hide positive tiny surfaces, or encode padding into stored geometry.

### 3. Remove preview decoration from rectangle sizing

- Replace the layout-affecting borders on the preview frame and preview widget boxes with equivalent non-layout decoration, such as inset box shadows. Retain visible frame/card boundaries and selected-state styling at ordinary sizes.
- Ensure the frame's inner coordinate area matches its assigned scaled surface dimensions. Preview cards must render at their assigned scaled sizes, even below 2px; do not clamp preview boxes upward or change geometry to accommodate decoration.
- Preserve the move/resize buttons, pointer capture, existing preview scale, widget selector, keyboard pixel controls, layer actions, and clipping of overflowing preview content. Tiny boxes need not make every gesture affordance physically usable; selecting covered widgets and using numeric fields remains the existing alternative.
- Limit editor JavaScript changes to presentation plumbing only if CSS cannot resolve the border floor. Do not alter raw input ownership, dirty-state tracking, `setSaving()`, or synchronization behavior as part of this task.

### 4. Verify geometry, recovery, and persistence invariants

- Extend pure projection tests with one-pixel width/height, independent-axis cases, and normal → tiny → normal projection of the same canonical records. Assert bounds, the per-axis temporary minimum, exact source-object preservation, and existing zero/nonfinite deferral.
- In real-browser regressions, compare all six live border boxes with `projectWidget()` output and the stage rectangle. Compare preview boxes with the same profile's scaled projection relative to the actual preview coordinate origin. Allow only a small explicit CSS subpixel tolerance, such as 0.1px, not a tolerance large enough to hide the old 6px overflow.
- Exercise width-only, height-only, and both-axis shrinking, including bottom/right edge placement, overlap/layers, and root font-size variation so the test does not assume `.5rem` is always 8px. Keep root-font changes test-local.
- Check normal-size computed padding and retain the existing 100px internal-scroll regression. Confirm Custom → Automatic restores prior flow without leaked style variables, then Custom restores bounded projection again.
- Exercise zero usable width and height separately: live stage and preview hide safely, geometry editing disables, and returning to a positive surface restores rendering without fabricated edits.
- Through an owned real-server fixture, track PUT requests and compare the complete stored preference snapshot/revision before and after shrinking and expanding. Compare canonical desktop/mobile geometry and the editor draft where available. Presentation-only resize must produce zero PUTs, unchanged revisions, and the original normal-size projection after recovery.
- Retain the existing native viewport containment scenario and all task 49 interaction assertions. Do not weaken or remove a failing check merely because the new deterministic fixture covers the same general area.

### 5. Document, verify, and commit the implementation

- Add a brief clarification to `docs/dashboard-layout.md` that decorative padding contracts on extremely small surfaces while normal widgets retain their spacing. Update the relevant testing notes in `docs/testing.md`; do not create a broad new guide or rewrite unrelated documentation.
- Run `node --test test/dashboard-layout.test.js test/dashboard-layout-view.test.js`, then the focused browser layout spec with an available `PLAYWRIGHT_PORT`. Run the full `npm test -- --test-timeout=10000` and complete browser suite after focused tests pass. Include the existing Firefox/Chromium exchange cases when engines are available; missing browsers are explicit blockers, not silent skips.
- Run `npm run check`, individual `node --check` commands for every changed JavaScript file, and `git diff --check`. Record the original failing regressions, final results/counts, and any remaining limitations in `4-implemented.md`.
- During implementation, bump the then-current patch version consistently in both package manifests, without changing dependencies. Commit only task-scoped implementation, tests, documentation, version, and results. Do not push, merge, publish, or operate a live service.

## Acceptance Criteria

- Every live custom widget's actual border box equals its bounded projected rectangle within browser subpixel tolerance on positive surfaces, including one-pixel axes. No padding or border floor enlarges it beyond the usable surface.
- Preview frame/card decoration does not change the geometry coordinate area or impose a minimum on scaled card rectangles. Bottom-left anchors, intentional overlaps, profile selection, and layer order remain unchanged.
- Padding remains `.5rem` on ordinary cards and contracts independently per axis on tiny cards. Existing 100px internal-scroll access and Automatic-mode presentation still pass.
- Zero/unavailable surfaces defer safely. Normal → tiny → normal transitions restore normal projection without changing canonical geometry, editor layout drafts, stored preferences, or revisions, and without a PUT.
- Deterministic CSS-rendering regressions fail before the fix and pass afterward. Focused/full Node/browser verification and syntax/diff checks pass, with honest prerequisite reporting.
- The fix addresses only warning 2. Polling/editor ownership warning 1 remains explicitly unresolved by this task.

## Risks and Decisions

- Prefer contracting decoration over disabling positive surfaces because the existing product contract explicitly fits available space below 100px. A one-pixel card is not expected to show readable content; geometry containment and recovery are the guarantees at that size.
- Geometry-derived variables intentionally cross the view/CSS boundary but remain presentation-only and scoped to custom nodes. Cleanup prevents them from leaking into Automatic mode. Do not introduce a shared geometry framework for this small adapter change.
- A controlled viewport proves box sizing deterministically but does not claim physical-device visual viewport coverage. Keep native viewport and existing fullscreen/touch scenarios as complementary integration checks.
- Preview borders and inset shadows can differ slightly in content inset or paint appearance. Preserve ordinary labels, hit targets, selected outlines, and pointer calculations, and confirm them through the existing browser suite.
- Browser fractional rounding may produce subpixel differences; assertion tolerance must stay well below the defect's padding/border excess. Do not use integer rounding of measured boxes to conceal a violation.
- No schema migration, coordinate conversion, database change, new dependency, live-provider access, real Wake packet, privileged operation, user-data edit, or `todo.md` change is authorized.
