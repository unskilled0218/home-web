# Goal

## Table of Contents

- [Command](#command)
- [Goal](#goal)
- [Acceptance Criteria](#acceptance-criteria)
- [Scope Boundaries](#scope-boundaries)

## Command

Implement the fullscreen reference-canvas request recorded in `~/workdir/command.md`: fullscreen displays the intended custom widget arrangement, while windowed mode uniformly scales the entire reference canvas to fit without independently rearranging or stretching widgets. Unused space is acceptable when aspect ratios differ. The Settings preview and pixel controls must use the same reference coordinates.

The follow-up discussion establishes a browser limitation: before fullscreen entry, `window.screen.width` and `window.screen.height` provide CSS-pixel estimates, not guaranteed future fullscreen viewport dimensions. Do not use `screen.availHeight` as the full screen height. Actual fullscreen viewport measurement can confirm the reference, which must remain stable after returning to windowed mode.

## Goal

Replace current-window custom-layout projection with a stable fullscreen-oriented reference canvas and one uniform fitting transform. Today, `public/dashboard-layout-view.js` derives the usable surface from current viewport dimensions and visible tools/status/caption reservations; `public/dashboard-layout.js` independently projects each axis and applies minimum clamps against that surface. Fullscreen changes both dimensions and tool visibility, so the same saved arrangement changes placement and proportions.

Keep reference geometry distinct from the current destination area. Tool visibility and ordinary window resizing may change available fitting space but must not redefine the reference layout. Preserve bottom-left placement and scale the complete presentation consistently, rather than merely shrinking card rectangles around unchanged content. The implementation plan must define reference sizing, reservation policy, fitting placement, and the transition from an estimated to a confirmed fullscreen size explicitly.

## Acceptance Criteria

- Custom layouts can be arranged before first fullscreen entry. Use a validated screen-size estimate with a documented safe fallback when screen dimensions are unavailable or invalid. Do not claim that browsers expose the exact future fullscreen viewport in advance.
- Confirm reference dimensions using the actual viewport on fullscreen entry and retain the confirmed reference after exit. Define how confirmation, screen/orientation changes, and desktop/mobile profiles affect local reference ownership without silently rewriting saved layouts or repeatedly rebasing an active editor.
- Use one scale factor for both axes to fit the reference canvas within the actual usable area. Preserve relative widget coordinates, sizes, proportions, bottom-left anchoring, and layer order; unused space may remain. Define any scale-up limit and placement of unused space consistently.
- Reserve safe-area margins and necessary caption/status space consistently. Showing or hiding dashboard tools must not rearrange reference geometry. Existing controls must remain reachable and unobscured.
- The Settings preview, displayed pixel values, numeric edits, and pointer conversion use the same reference coordinate contract. Moves and layer actions preserve unrelated canonical fields and the other profile; canceled and no-op operations retain original geometry.
- Preserve independent desktop/mobile profiles, intentional overlap, visibility/fullscreen options, content selections, and Automatic layout behavior. Retain tiny-surface outer-box containment and safe zero-surface deferral. Resolve minimum-size behavior in reference space so post-fit clamping does not defeat uniform scaling.
- Entering/exiting fullscreen, fitting, tool visibility changes, and resizing never save preferences, mutate canonical geometry, or increase the shared revision. Keep stored layouts compatible; document and test any required coordinate-contract or schema migration rather than silently changing interpretation.
- Add deterministic model and real-browser regressions for estimated/confirmed reference sizing, fullscreen/windowed transitions, mismatched aspect ratios, uniform scaling, tool visibility, editor consistency, zero/tiny surfaces, and normal-size recovery. Check actual DOM geometry and complete saved preferences/revisions, not only CSS declarations.
- Run relevant focused tests, full Node/browser verification, individual syntax checks for changed JavaScript, and `git diff --check`. Record actual results and browser/environment limits.

## Scope Boundaries

This stage creates only this goal document; no implementation, dependency, version, runtime data, or existing task report is changed. Subsequent work must retain the existing shared preference/save owner and avoid introducing fullscreen-only autosave or per-resize persistence. Keep task 49's polling/editor ownership warning separate. Do not change user data, configuration, live services, dependencies, legacy layout behavior, or `todo.md` without separate authorization. Do not push, merge, publish, or operate a release as part of this task.
