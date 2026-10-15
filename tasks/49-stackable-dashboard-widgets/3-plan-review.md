# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/49-stackable-dashboard-widgets/2-plan.md` at `45bbdfe`, against `1-goal.md` and the current dashboard preference, display, and synchronization boundaries. Implementation does not exist yet; findings describe plan risks, not proven production defects.
**Health Score:** 95/100
**Trend:** 100 → 95 (−5) against the preceding PR Review record, which reviewed task 47 implementation. Different scopes are not a measured regression in running code.

The plan preserves the current settings owner and isolates layout rendering appropriately, but its inverse geometry-edit contract needs one clarification before implementation.

## Findings

### Warning

**Change Propagation (R2) — moving a clamped widget can accidentally rewrite its size**

Symptom: `2-plan.md:19-21,55-56` defines proportional saved rectangles, minimum-clamped pixel projection, and mapping an edited widget back into units. It requires other widgets to remain unchanged but does not require unchanged fields within the edited widget to retain their canonical values. The tests at `2-plan.md:70` similarly protect other records and layer-only edits, not width/height during position-only edits. Projection is deliberately lossy when a dimension hits the 100px minimum, so converting the entire displayed rectangle back to units is not an inverse of the saved geometry.

Source: The Pragmatic Programmer — Orthogonality; A Philosophy of Software Design — Information Hiding and Leakage. Presentation constraints must not leak into unrelated persisted dimensions when the user changes only position.

Consequence: With the proposed 1,000,000-unit basis, a saved width of 100,000 units renders as 160px on a 1600px surface but is clamped from 80px to 100px on an 800px surface. If a drag re-encodes that whole displayed rectangle, width becomes 125,000 units and renders as 200px on the larger surface. The user only moved the widget, yet its shared size changed by 25%. Unchanged-field re-encoding can also introduce rounding drift during repeated moves or numeric edits, despite zero writes on viewport resize itself.

Remedy: Specify field-specific model operations. A move changes only canonical `x`/`y`, preserving `w`/`h` exactly; a single numeric-field edit changes only that dimension and any explicitly necessary containment adjustment; a resize changes only the dimensions/anchored edges the gesture intentionally edits. Start from the original canonical item, not a whole projected rectangle. Preserve the original item on no-op/canceled gestures and retain the existing strict bounds. Add pure-model and cross-viewport browser regressions for moving a minimum-clamped widget, editing one axis, and no-op gestures, asserting unrelated canonical fields remain exact and the larger-window size does not change after the move/save.

## Review Basis

- The six widgets, accessible layer actions, covered-widget list, 100px physical minimum with tiny-window fallback, internal scrolling, and viewport-bounded maximum match the goal. Automatic/null profiles are a justified compatibility boundary rather than a speculative second layout system.
- One bounded nested preference, one server revision/cache/save owner, strict old-record decoding, and complete writes avoid competing persistence. The plan explicitly accounts for the current scalar comparison rejecting new object references and for incomplete older pages needing a reload.
- The pure layout module has no dependency on the helper that imports it. Separate view/editor modules keep DOM measurement and pointer mechanics out of schema validation and the main coordinator. No new dependency, generic widget framework, legacy-home API revival, or collision engine is proposed.
- Wrapper stacking contexts, actual hit testing, focus/DOM identity, all-hidden measurement, caption/fullscreen behavior, and existing 1000px/600px rules are identified rather than assuming child z-index alone suffices. Confirmed live geometry remains separate from the unsaved preview and existing controller/timer owners.
- Dirty draft/revision ownership, failed/409 saves, pending writes, layout-only cancel, explicit reload, and unaffected credential drafts have concrete planned behavior. Unit/API and real-browser cases cover the core risks; the missing within-widget geometry preservation is included in the finding rather than counted again as a coverage issue.
- All six decay dimensions were considered at plan level. No additional actionable change-propagation, cognitive-load, duplication, complexity, dependency, or domain-language finding survived the stated tradeoffs. Formal production Quick Test Check is skipped for this documentation-only review; proposed verification was evaluated for feasibility instead.
- No `.brooks-lint.yaml` exists; balanced defaults apply. Score: 100 minus one warning at five points.

## Verification And Limits

Read the goal/plan and supporting `public/dashboard.js`, `public/dashboard-helpers.js`, `public/dashboard-display.js`, and `src/dashboard-preferences.js`. A standalone arithmetic check confirmed the 100,000 → 125,000 unit / 160px → 200px round-trip example; it did not exercise an implemented layout function. No server, provider, browser suite, user storage, dependency installation, or release operation was used. No implementation or plan changes were made.

## Summary

Clarify field-specific inverse edits and add the minimum-clamped move regression before implementing the plan. The remaining ownership, compatibility, accessibility, stacking, and verification decisions are coherent; this review does not certify a future implementation.
