# Brooks-Lint Review

**Mode:** PR Review
**Scope:** All changes on `37-mobile-display-preferences` relative to `main`, merge base `154c47c`, through implementation commit `3a14dc3`. One implementation commit changes 10 files with 424 additions and 21 deletions. The complete diff inventory was examined; detailed review prioritizes preference normalization, presentation and timer ownership, mobile CSS, Settings controls, and the added verification. `package-lock.json` was skipped as generated content.
**Health Score:** 99/100
**Trend:** 94 → 99 (+5) from the previous PR Review. The previous scope reviewed this task's plan, so the scores are not a like-for-like code quality trend.

The implementation follows the reviewed plan and preserves refresh ownership, with one minor test-maintainability suggestion.

## Findings

### Suggestion

**Test Brittleness — Clock geometry assertion duplicates the CSS implementation**

Symptom: `e2e/dashboard-home.spec.js:204–205` computes its expected clock font size with `Math.max(24, Math.min(width * 0.08, 48)) * scale`, repeating the exact clamp constants from the mobile `#time` rule in `public/dashboard.css`. The goal requires independent effective scaling, readable content, and viewport fit, but does not make those specific base clamp values a public contract.

Source: *xUnit Test Patterns* — Over-specified Tests; *The Art of Unit Testing* — test isolation and behavior-focused assertions.

Consequence: Adjusting the base clock typography while preserving scale behavior and fit would fail the parameterized geometry cases and require coordinated CSS/test edits. This couples an otherwise useful regression check to a styling detail and can discourage harmless layout tuning. The nearby real geometry and clipping checks already verify the user-visible layout requirements.

Remedy: Replace the copied clamp calculation with a browser-measured scale-1 baseline for each viewport and assert the expected 0.5× and 2× relationships. Keep the checks for independent view sizing, desktop-scale isolation, readable clock content, and absence of overflow. This preserves coverage against ineffective or double-applied scaling while allowing the base font clamp to change independently.

## Quick Test Check

Corresponding tests exist for changed production behavior. Node checks exercise legacy defaults, strict input handling, scale quantization, independent projections, and form ownership. Browser checks exercise real visibility, sizing, geometry, storage, drafts, DOM identity, and viewport transitions with controlled service responses. Network and timer observations directly protect the requirement that resizing not add refresh owners or integration requests; their use is justified rather than mock-only wiring verification.

The reviewed implementation passed `npm run check`, separate syntax checks for changed JavaScript files, all 174 Node test entries, and all 41 Chromium cases during implementation. No full suite was repeated in this documentation-only review stage. The six populated mobile cases cover 320px and 390px at scales 0.5, 1, and 2, and the request-owner cases check both directions of calendar profile eligibility. No separate coverage, mock-abuse, or test-obscurity findings were identified.

## Summary

No critical or warning findings were identified in this branch's changes. The sole suggestion concerns an overly specific assertion, giving a 99/100 score under the default balanced deduction.

The presentation resolver is pure and does not replace saved profiles. Breakpoint changes use the narrower presentation path, move existing DOM nodes into reading order, preserve Settings drafts, and avoid service reconfiguration. Stable calendar eligibility across both profiles is an explicit documented tradeoff with verification for hidden views and normal refresh cadence. Mobile scales match native form validation, shared format/unit controls retain accurate scope, and the dependency direction remains consistent. This stage records findings only and applies no implementation or test fixes.
