# Goal

## Table of Contents

- [Command](#command)
- [Goal](#goal)
- [Acceptance Criteria](#acceptance-criteria)
- [Scope Boundaries](#scope-boundaries)

## Command

The user clarifies that long press should enable direct editing on the dashboard, not merely open the Settings preview. Recreate task 52 for that behavior, replacing the deleted Settings-shortcut goal. This explicit request supersedes the earlier shortcut-only requirements in `~/workdir/command.md`.

## Goal

Let users long-press a widget to enter a clearly marked dashboard layout edit mode, select that widget, and move or resize it directly in place. Provide a persistent toolbar with Save, Cancel, widget selection, and layer controls, plus a discoverable keyboard-accessible Edit layout action. Keep ordinary dashboard interactions safe by disabling bookmark navigation and device actions throughout edit mode.

Reuse the existing normalized geometry, fullscreen reference coordinates, profile handling, and shared preference/revision owner. Direct manipulation previews an explicit local draft on the dashboard; it does not publish shared state until Save succeeds. Cancel restores the confirmed layout, and failed/conflicting saves must not erase the draft or masquerade as shared success. The implementation plan must define ownership between direct editing and the existing Settings editor rather than creating competing sessions or writers.

## Acceptance Criteria

- A primary-pointer hold of approximately 600ms on a visible widget's non-interactive area enters direct edit mode and selects that widget without opening Settings. Support mouse, touch, and pen. Early release, meaningful movement, scrolling, pointer cancellation, visibility loss, and disposal cancel pending activation; secondary pointers and stale timers cannot trigger an unintended session.
- Exclude links, buttons, editable content, and other interactive descendants from activation. Preserve normal short clicks and scrolling outside edit mode. Handle touch context menus narrowly, without globally suppressing browser behavior or allowing a release/click to activate a control beneath the editing affordance.
- Edit mode is visually unmistakable. Show selection outlines and dedicated move/resize handles on dashboard widgets. Moving/resizing one widget changes only its intended fields, preserves unrelated geometry, and supports intentional overlap without collision relocation. Provide named layer actions and a selector for covered widgets.
- While editing, block all bookmark navigation, Wake-on-LAN dispatch, and other device actions from the dashboard through both pointer and keyboard interaction. Existing pending actions may finish normally, but manipulating a widget must never initiate another action. Keep the toolbar and editing controls above widget layers and accessible in fullscreen.
- Provide a discoverable Edit layout action for keyboard users and anyone unable to long-press. Offer keyboard/numeric geometry controls as an alternative to pointer manipulation, accessible names, visible focus, and sensible focus entry/restoration. Covered widgets must remain selectable without clicking through top widgets.
- Keep a persistent Save and Cancel toolbar. Save uses the existing shared preference transaction and captured base revision; Cancel discards local edits and restores the latest confirmed layout. Do not autosave on entry, selection, gestures, resize, fullscreen changes, or exit. Opening edit mode alone must not change shared preferences or revisions.
- Define explicit Automatic-to-Custom draft initialization: users can edit an Automatic dashboard directly, but shared mode/geometry changes occur only after Save. Cancel restores Automatic when it remains the confirmed mode. Preserve independent desktop/mobile profiles and existing visibility choices; selecting a hidden widget must not enable its service or dispatch an action.
- Freeze accepted reference coordinates for the edit session and convert pointer movement through the actual canvas fit scale. Preserve bottom-left anchoring, minimum-clamped field semantics, no-op/canceled gesture invariants, tiny-surface containment, and safe zero-area deferral. Define profile/fullscreen/orientation/visibility transitions and interrupted gestures explicitly so stale transforms cannot corrupt geometry.
- Keep direct-edit drafts isolated from remote confirmed snapshots. Retain edits and actionable feedback after failed/stale saves; do not silently advance the base revision or overwrite unrelated settings. Prevent simultaneous Settings/direct-edit sessions from resetting drafts, nesting reference locks incorrectly, or creating a second persistence owner. Define explicit reload/discard and pending-save behavior.
- Preserve live widget identity, content selections, scroll state where feasible, existing provider/timer ownership, and pending device completions. A layout gesture must not reconfigure providers or recreate actionable widget content unnecessarily.
- Add deterministic pointer/timer/state tests and real-browser regressions for activation/cancellation, direct mouse/touch manipulation, keyboard access, covered-widget selection, layers, action blocking, reference-scale conversion, fullscreen, Automatic/Custom transitions, Cancel, save/failure/conflict behavior, remote updates, focus, and zero unintended writes/actions. Document direct edit mode and run focused/full verification, individual JavaScript syntax checks, and `git diff --check`.

## Scope Boundaries

This stage recreates only task 52's goal; no application code, tests, versions, dependencies, runtime data, or command file is changed. Direct dashboard editing replaces the previous Settings-shortcut-only objective. Reuse the existing save/revision owner; do not introduce autosave, another settings store, or a generic widget framework. Keep the inherited polling/editor ownership warning separate unless a narrowly required session integration is explicitly identified during planning. Preserve user data/configuration, live services, legacy layout behavior, and `todo.md`. Do not push, merge, publish, or operate a release.
