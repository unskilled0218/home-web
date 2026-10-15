# Goal

## Table of Contents

- [Command](#command)
- [Goal](#goal)
- [Current Behavior](#current-behavior)
- [Acceptance Criteria](#acceptance-criteria)
- [Scope Boundaries](#scope-boundaries)

## Command

The current request in `~/workdir/command.md` is:

> - edit with same size as dashboard
> - `save`, `cancel` top right
>   - right click widget to editing toolbar
>   - or `toolbar` button next to `save` button

User clarification: keep move/resize editing as the current behavior. The on-demand toolbar changes access to detailed controls, not direct manipulation.

## Goal

Keep dashboard widgets at their normal displayed size while editing. Replace the always-expanded layout toolbar with compact top-right Save, Cancel, and Toolbar controls. In edit mode, right-clicking a widget selects it and opens the editing toolbar; the Toolbar button provides an equivalent keyboard- and touch-accessible route. Opening or closing editing controls must not shrink, move, or rescale the dashboard canvas merely to make room for chrome.

Keep the current direct move/resize behavior on dashboard editing frames: drag the labeled frame to move and its selected upper-right handle to resize. These affordances remain available with the detailed toolbar closed; neither right-click nor opening the toolbar is required to move or resize. Move the existing detailed controls into the on-demand toolbar without replacing or redesigning direct manipulation. Keep local drafts, explicit Save/Cancel, shared revision protection, and dashboard action blocking unchanged. This task refines task 52's editing experience rather than creating another editor or restoring layout controls in Settings.

## Current Behavior

- `public/index.html` places Save/Cancel, recovery controls, profile/widget selectors, numeric geometry, layers, reset, and status inside one expanded `#layout-toolbar`.
- `public/dashboard.css` stretches that toolbar across the viewport and caps its height at 48dvh. Only its Save/Cancel row is sticky; controls are not grouped at the top right as requested.
- `public/dashboard-layout-view.js:measureLayoutSurface()` reserves the toolbar's bottom edge when calculating destination space. Entering edit mode therefore reduces the fitted canvas and widget sizes; toolbar visibility affects geometry despite unchanged reference coordinates.
- `public/dashboard-layout-editor.js` already owns local drafts, inert live widgets, fixed-start gestures, recovery, and explicit saves. Its capture guard blocks context menus on real widgets during editing, while editing frames have no widget-toolbar context action. The replacement must integrate with these existing boundaries.

## Acceptance Criteria

- For an unchanged Custom layout, entering and leaving editing preserves the normal dashboard's canvas fit, widget border boxes, and content scale at the same viewport and reference. The editing chrome itself does not consume additional canvas space. Legitimate geometry edits, viewport changes, and accepted reference updates remain distinguishable from chrome-induced changes.
- Save and Cancel remain clearly visible at the viewport's top right during editing, with a Toolbar button next to Save. Controls remain reachable within safe areas, in fullscreen, and on narrow/short windows without a large permanently expanded panel.
- The detailed editing toolbar is not permanently expanded on entry. Toggling it open or closed does not change the dashboard's canvas size, fit scale, or canonical draft. It overlays the dashboard with bounded placement/scrolling rather than pushing widgets away.
- Preserve the current primary-pointer move and upper-right resize gestures, selection outlines, pointer capture, scale-correct deltas, and cancellation behavior. Move/resize handles remain usable while the detailed toolbar is closed. Right-click is an additional route to detailed controls, not a replacement gesture or prerequisite for direct editing.
- In edit mode, right-clicking a widget's editing frame selects that widget and opens the toolbar for it. Consume only that editing context-menu action; do not navigate bookmarks, dispatch device actions, start a competing gesture, or save implicitly. Ordinary right-click behavior outside editing, especially links and controls, remains unchanged.
- The Toolbar button works without right-click and supports keyboard and touch users. It exposes the current selection and a selector for covered or hidden widgets. Provide accessible names, visible focus, sensible focus restoration when closing the toolbar, and a clear way to dismiss it without discarding the draft.
- Keep profile and Automatic/Custom selection, numeric X/Y/width/height, all layer controls, Automatic reset, explicit Reload/discard, fullscreen access, and actionable save/conflict/offline status available. Closing the detailed toolbar must not act as Cancel or destroy focused raw inputs; reopening shows the same session draft and selection.
- Live widget nodes remain inert throughout editing, whether the toolbar is open or closed. Pending actions may complete normally. Save still uses the existing complete captured preferences and revision; changed saves alone publish, no-op Save does not write, and Cancel restores the latest confirmation.
- Preserve existing canonical field isolation, bottom-left coordinates, minimum-clamped sizes, fixed-reference ownership, accurate frame/live alignment, canceled/no-op gestures, profile independence, and tiny/zero-surface recovery. Real viewport/reference changes still refit safely and cancel stale gestures as needed. Showing or hiding chrome must not manufacture a fit change that cancels a gesture or corrupts its coordinates.
- Preserve the established Automatic editing-template behavior without promising identical placement to Automatic flow. For the same effective template, showing/hiding the toolbar must not change fitting or materialize Custom. Editing an inactive profile remains explicit and does not enable hidden content or providers.
- Add regressions comparing actual pre-edit, edit, toolbar-open, toolbar-closed, and post-Cancel canvas/widget/content measurements. Verify top-right placement, fullscreen and short-window accessibility, right-click selection, keyboard/touch toolbar access, raw-input retention, action blocking, pending saves, conflicts, and zero unintended PUTs. Migrate assertions that depended on reserved toolbar space without dropping their geometry/safety claims. Update active layout documentation to describe the new controls.

## Scope Boundaries

This stage creates only task 53's goal and commits it. It does not implement UI changes, write an implementation plan, update versions, or modify task 52's completed records. Later implementation must reuse the current editor/session, geometry/reference helpers, and sole shared settings writer. No autosave, second editor, persistence/schema change, provider redesign, dependency addition, or unrelated Settings change is requested. Preserve retained legacy layout functionality, user data/configuration, and `todo.md`. Do not push, merge, release, publish images, or operate live services.
