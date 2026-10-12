# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review: `tasks/37-mobile-display-preferences/2-plan.md`, checked against `1-goal.md`, existing preference normalization, Settings fieldsets, and controller configuration. Findings refer to the input plan before this review's edits.
**Health Score:** 94/100
**Trend:** 90 → 94 (+4) from the previous PR Review. The previous scope reviewed task 36's implementation branch, so the scores are not a like-for-like quality trend.

The plan meets the goal and separates presentation from refresh ownership, with one validation gap and one Settings-labeling issue to resolve.

## Findings

### Warning

**R3 — Knowledge Duplication: storage and form disagree on valid mobile scale values**

Symptom: Step 1 accepts any finite mobile scale within 0.5–2 using the existing clamp-only number normalizer, while Step 2 gives mobile scale inputs `step="0.1"`. A stored value such as `1.25` therefore passes normalization and fills the form but fails native step validation. The generic preferences submit handler validates every associated control, including controls in hidden panels.

Source: *The Pragmatic Programmer* — DRY, duplicated decisions about one invariant; *Code Complete* — boundary validation and defensive programming.

Consequence: An in-range stored mobile value can block unrelated preference saves until the user discovers and changes the hidden invalid control. Loading preferences does not guarantee an editable, valid Settings form, despite the goal's requirement to handle invalid mobile fields and preserve normal saving.

Remedy: Define mobile scale precision together with bounds in Step 1: default invalid input to 1, clamp finite numbers to 0.5–2, and round mobile scales to one decimal place before exposing them to the form. Retain the proposed 0.1-step UI and current desktop normalization. Add normalization cases for in-range fractional values such as `1.25`, plus a browser case that seeds fractional mobile values, opens Settings, and successfully saves an unrelated preference without step-mismatch failures. Document the mobile scale increment.

Evidence: A read-only Chromium check of an input with `min=0.5`, `max=2`, `step=0.1`, and `value=1.25` reported no range violation but `stepMismatch: true` and `valid: false`. The current numeric normalizer only clamps finite values and would retain `1.25` under the original plan.

### Suggestion

**R6 — Domain Model Distortion: desktop-only legends would contain shared preferences**

Symptom: Step 2 instructs relabeling existing per-view fieldsets as **Desktop display** without separating their shared controls. `public/index.html:51–57` includes timezone, date style, 12-hour format, and seconds in the clock fieldset; lines 61–67 include temperature, wind, and precipitation units in the weather fieldset. The goal explicitly keeps those settings shared across layouts.

Source: *Domain-Driven Design* — Ubiquitous Language; *The Mythical Man-Month* — Conceptual Integrity.

Consequence: The Settings grouping would imply that changing timezone, format, or weather units affects only desktop, while mobile would change too. This conflicts with the feature's distinction between dedicated mobile visibility/scale and shared formatting and creates misleading control ownership.

Remedy: In Step 2, restrict **Desktop display** to the existing visibility and per-view scale controls. Move the Time panel's common controls into a **Shared format** fieldset and the Weather panel's unit controls into **Shared units**, preserving each control's label, name, form association, and shared stored value. Verify grouping and shared behavior in both viewport modes without adding duplicate controls.

## Summary

Both findings are addressed in the revised `2-plan.md`, with targeted verification and acceptance criteria. The 94/100 score records the reviewed input plan under balanced deductions: one warning and one suggestion. No implementation code changed; the Quick Test Check was skipped for this documentation-only review.

The independent projection, single media listener, actual DOM order, and narrow resize path are appropriate to the current dashboard. Calendar eligibility across both saved profiles is an explicit, documented tradeoff that prevents breakpoint-triggered refreshes. No further findings were identified for change propagation, cognitive overload, speculative abstractions, or dependency direction at plan level.
