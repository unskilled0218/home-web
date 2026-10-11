# Brooks-Lint Review

**Mode:** PR Review
**Scope:** `tasks/33-photo-dashboard-home/2-plan.md`, checked against `1-goal.md` and the relevant route, frontend, database, and test dependencies. This is a plan review, not a whole-project assessment.
**Health Score:** 99/100
**Trend:** 15 → 99 (+84) across the last two PR Review records; scopes differ, so this does not measure project improvement.

The plan is actionable and preserves the shared server dependencies; one test-organization suggestion is addressed below.

## Findings

### Suggestion

**R1 Cognitive Overload — Separate routing checks from presentation checks [quick-fix]**

Symptom: The original plan's Step 4 says to rewrite the initial route/static test in `test/dashboard.test.js` while retaining asset, icon, forecast/calendar markup, and containment assertions. The current test at `test/dashboard.test.js:22–92` already mixes all those concerns with widget presentation checks; the plan adds redirect and retired-asset behavior to that same test without separating its responsibilities.

Source: Refactoring — Long Method; A Philosophy of Software Design — complexity from mixed responsibilities.

Consequence: An early document or redirect assertion failure prevents later asset and containment checks from running. Routing changes and presentation changes continue to require edits in the same large test, making failures harder to isolate during this cleanup.

Remedy: Update Step 4 of `2-plan.md` to replace the omnibus test with named tests for home documents, legacy redirects, asset availability/headers, static containment, and existing presentation invariants. Use a small local server fixture with cleanup per test; preserve the existing assertions for retained behavior without adding a generic test framework.

Status: Accepted. Step 4 now specifies separate tests and retains the existing presentation checks independently.

## Review Coverage

- Change Propagation: The document replacement, route change, frontend removals, and affected documentation/tests serve one goal. Retained APIs and data avoid unrelated backend changes.
- Cognitive Overload: The test organization finding above is the only actionable issue found.
- Knowledge Duplication: Removing the duplicate HTML document establishes one page source. Keeping asset names and the preference key avoids parallel migration logic.
- Accidental Complexity: Explicit redirects and reuse of the existing dashboard are sufficient. A replacement management interface and backend settings refactor are correctly excluded.
- Dependency Disorder: `src/home-settings.js` imports from `public/home-layout.js`, and `src/db.js` uses that facade. The plan explicitly retains this runtime dependency and its tests.
- Domain Model Distortion: The scope distinguishes the photo dashboard from the retired widget UI and describes retained integrations as backend capabilities.
- Quick Test Check: Skipped because this change contains planning documentation only. Test instructions were checked for feasibility, but no implementation or tests were changed or executed.

## Summary

No Critical or Warning findings were found. The single Suggestion is addressed in `2-plan.md`; the score records the reviewed plan before correction, not a projected implementation score. The revised plan is ready for implementation.
