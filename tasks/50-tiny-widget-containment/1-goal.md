# Goal

## Table of Contents

- [Command](#command)
- [Goal](#goal)
- [Acceptance Criteria](#acceptance-criteria)
- [Scope Boundaries](#scope-boundaries)

## Command

Fix warning from `tasks/49-stackable-dashboard-widgets/5-code-review.md`: `2. R6 Domain Model Distortion: Tiny projected rectangles are smaller than their padded CSS boxes`.

## Goal

Make all six custom dashboard widgets remain physically contained within their projected rectangles when the usable surface is smaller than the normal 100px minimum, including dimensions below the CSS padding floor. Preserve the documented temporary minimum reduction rather than allowing padding or borders to enlarge the rendered boxes beyond the available surface.

The pure projection in `public/dashboard-layout.js` already limits dimensions to the available surface, but `public/dashboard.css` applies fixed `.5rem` padding to custom cards. The review reproduced a 10px-high usable surface with 16px-high rendered widgets. Align actual live-view box sizing with the geometry contract and keep preview rendering consistent, including its own border floor where relevant.

## Acceptance Criteria

- Actual border boxes for every custom widget fit within the usable surface on both axes, including positive widths and heights below 16px. Preserve bottom-left anchoring and intentional layer order.
- Add deterministic real-browser regressions that explicitly establish tiny usable dimensions and assert actual DOM rectangle bounds, rather than relying on incidental tool/status wrapping at a single viewport size. Cover width-only, height-only, and both-axis constraints.
- Keep live projection and editor preview consistent with the same bounded dimensions. A zero-sized or unavailable surface continues to defer rendering/editing safely.
- Preserve ordinary 100px minimum sizing when space permits, normal padding/presentation, internal scrolling, Automatic layout, visibility, and existing editing behavior.
- Shrinking and expanding the surface does not mutate canonical geometry, write preferences, or increase the shared revision. Saved dimensions recover their normal projection when space returns.
- Run focused layout/model/view/browser regressions, the full Node and browser suites, individual syntax checks for changed JavaScript, and `git diff --check`. Record actual results and any environment blockers.

## Scope Boundaries

Address only review finding 2 and directly related tests or documentation. Finding 1, concerning polling and unfinished editor work, remains a separate issue. Do not change persistence schemas, coordinate versions, shared save ownership, runtime dependencies, legacy layout behavior, user configuration/data, live services, or `todo.md`. This goal stage creates only this task document; it does not implement fixes.
