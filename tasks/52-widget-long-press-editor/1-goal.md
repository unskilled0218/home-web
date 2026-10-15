# Goal

## Table of Contents

- [Command](#command)
- [Goal](#goal)
- [Acceptance Criteria](#acceptance-criteria)
- [Scope Boundaries](#scope-boundaries)

## Command

Implement the request in `~/workdir/command.md`: long-press a dashboard widget to open the existing Settings layout editor with that widget and the active desktop/mobile profile selected. Keep dragging and resizing in the preview, and provide a discoverable keyboard-accessible “Edit layout” action.

## Goal

Make layout editing easier to discover and reach without turning live dashboard content into a drag surface or risking device actions. A primary-pointer hold of approximately 600ms on a visible widget's non-interactive area should enter Settings → General → Widget layout. Use the existing Settings session, reference-coordinate lock, draft, preview, and Save preferences ownership rather than creating another editor or writer.

Currently, `public/dashboard.js` opens Settings only through the Settings button, initializes preference/integration drafts, locks references, and restores focus to that button on close. `public/dashboard-layout-editor.js` owns profile/widget selectors but exposes no explicit selection entry point. The implementation plan must define a shared Settings entry path, safe widget selection, trigger-aware focus restoration, and narrowly scoped pointer/timer ownership across Automatic and Custom DOM arrangements.

## Acceptance Criteria

- A primary mouse, touch, or pen hold on an eligible visible widget area for approximately 600ms opens the existing layout editor once, selects the active profile and targeted widget, reveals the editor, and places focus sensibly. Covered widgets remain accessible through the existing selector.
- Early release, meaningful movement, scrolling, pointer cancellation, page visibility loss, disposal, and loss of target eligibility cancel pending work. Secondary pointers never start a competing editor activation. Stale callbacks cannot reopen Settings after cancellation or disposal.
- Links, buttons, form controls, editable content, and other interactive descendants are excluded. Ordinary short clicks and scrolling retain their behavior. Long press must not dispatch Wake-on-LAN, invoke another device action, navigate a bookmark, or cause a delayed click-through. Scope any touch context-menu handling to the eligible gesture rather than disabling browser behavior globally.
- Provide a discoverable keyboard-accessible “Edit layout” action with an accessible name and visible focus. It opens the same editor without requiring long press. Restore focus to a valid originating control or widget context on close, with a safe fallback if the origin becomes hidden or disconnected.
- Route all entry methods through the existing Settings lifecycle and reference lock. Do not reset an already-open dialog's unsaved drafts, create a second modal/session/save owner, or advance its base revision merely to select a widget. Define behavior during pending saves and unavailable layout surfaces explicitly.
- Opening the editor or selecting a widget/profile does not change canonical geometry, enable Custom automatically, write preferences, or increase the shared revision. Automatic remains Automatic until the user explicitly chooses otherwise. Saves, cancel/reset/reload, failures, and conflicts retain their existing ownership.
- Preserve fullscreen access, bottom-left/reference-canvas fitting, independent profiles, intentional overlap and hit testing, tiny/zero-surface behavior, selected content, pending device actions, and service/timer ownership. Hidden or background widgets cannot steal the visible target's gesture.
- Add deterministic pointer/timer tests and real-browser coverage for successful activation, cancellations, secondary pointers, excluded interactive descendants, stale callbacks, lifecycle cleanup, mouse/touch input, keyboard entry, fullscreen, profile/widget selection, focus restoration, and zero unintended writes/actions. Document the shortcut and run relevant focused/full verification, syntax checks, and `git diff --check`.

## Scope Boundaries

This stage creates only this goal document. Do not implement direct on-dashboard dragging/resizing, autosave, another persistence store, or fixes for the inherited polling/editor ownership warning. Preserve user data/configuration, live services, dependencies, legacy layout behavior, and `todo.md`. Implementation, tests, versions, existing task reports, release operations, pushing, and merging are outside this goal-writing stage.
