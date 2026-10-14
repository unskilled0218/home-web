# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/44-background-display-options/2-plan.md` at `6dfb9eb`, checked against `1-goal.md` and the current preference, presentation, photo, calendar, and layout boundaries. No implementation or runtime behavior is claimed verified.
**Health Score:** 99/100
**Trend:** 94 → 99 (+5) from the latest PR Review record, which reviewed task 43 implementation; this is not a like-for-like trend.

The plan is ready to implement after a small clarification separating frequent layout callbacks from controller/timer side effects.

## Findings

### Suggestion

**R2 Change Propagation — make caption-driven layout updates explicitly side-effect bounded**

Symptom: `2-plan.md:40-45` proposes one presentation boundary called from preference, viewport, fullscreen, and photo-caption updates. It correctly requires caption updates not to restart the photo owner or start another service, but does not specify the boundary between DOM-only layout application and controller/timer updates. Current `public/dashboard.js:159-181` composes presentation with `startClock()` and `bookmarks.setPresentation()`. The latter emits state and invokes `queueRequired()` in `public/dashboard-bookmarks.js`, which can start eligible folder work. Extending the current composed path directly to `photos.show()`/`clearPhotos()` would therefore give slideshow callbacks unrelated timer/request side effects.

Source: *The Pragmatic Programmer* — Orthogonality; *A Philosophy of Software Design* — Information Hiding. Photo-caption geometry should depend on projected visibility, not on an integration controller's scheduling protocol.

Consequence: An implementation could satisfy visible track/hidden-state tests while resetting the clock interval or queuing due bookmark requests whenever a filename changes. That couples slideshow cadence to service refresh behavior and conflicts with the plan's deliberately unchanged ownership policy. This is a planning clarification, not a demonstrated defect in implementation that does not yet exist.

Remedy: Specify a DOM-only visibility/layout application function for caption callbacks: it may update section/wrapper hidden state, layout tracks/classes, and the background-only fullscreen tool exception, but must not configure controllers, reset timers, reload manifests, or mutate preferences. Keep controller/timer coordination in the existing preference/viewport lifecycle and apply it only for relevant transitions. Both paths can consume one derived visibility decision without duplicating policy. Add a deterministic test that repeatedly changes and clears captions across several slideshow transitions while asserting stable clock timer identity/deadline, photo ownership, and bookmark/integration request counts; retain the separate tests for legitimate preference-driven changes.

## Assessment

- Scope and Change Propagation: the planned files share one overlay-visibility objective. Moving existing controls, adding six profile booleans, and adapting the affected tests are necessary coordinated changes, not unrelated feature work. Archived shutdown and bookmark membership/disclosure remedies remain excluded.
- Cognitive Overload: the plan distinguishes active-profile visibility, effective fullscreen visibility, wrapper presence, optional caption presence, and content-request eligibility. Those distinctions are supported by current behavior and avoid silently treating a checkbox as a disconnect or document-visibility signal. No speculative abstraction or generic layout framework is required.
- Knowledge Duplication: one `resolveDisplayPreferences()` projection and one track/wrapper decision are planned. Existing Time/Weather/Calendar fields are reused, controls are moved rather than copied, and each field must have one form-associated input. The suggestion above clarifies callback composition without requiring a second visibility policy.
- Accidental Complexity: the plan uses the current preference row, revision API, local confirmed cache, controllers, and fullscreen API. It adds no storage owner, integration endpoint, polling loop, native launcher, or browser-permission workaround.
- Dependency Disorder: the schema/projection helpers can remain DOM-free; browser composition owns section elements and CSS state. No required cycle or infrastructure dependency in the preference model was found.
- Domain Model Distortion: Desktop/Mobile groups preserve the established independent profiles and the 600px/1000px distinction. Visibility remains separate from connection, selection, content eligibility, image effects, and optional image information. Default-true decoding preserves new sections' current behavior while old hidden values and strict complete writes remain protected.
- Layout/fullscreen coverage: the plan explicitly removes absent column/row groups, preserves baseline all-visible geometry, addresses caption-only wrappers, and keeps tools reachable when effective fullscreen policy leaves no sections. It does not incorrectly rely on `hidden` alone to collapse explicit tracks.
- Quick Test Check: skipped as a production/test-code review because the scope is a documentation-only plan. Proposed verification includes actual persistence/conflicts, both profile boundaries, computed tracks/bounding boxes, all-hidden/fullscreen cases, retained connections/actions, and photo/request-owner stability. No tests or runtime server were run during this review.
- No `.brooks-lint.yaml` was found; balanced defaults apply. Score calculation is 100 minus one suggestion at one point. There are no Critical or Warning findings.

## Summary

Make the caption callback contract DOM-only so layout changes cannot inherit integration scheduling or timer resets. Otherwise, the plan preserves existing settings/data boundaries and has actionable migration, geometry, fullscreen, and owner-independence checks. Only this review and its history record are committed; the plan, implementation, dependencies, version, user data, and `todo.md` remain unchanged.
