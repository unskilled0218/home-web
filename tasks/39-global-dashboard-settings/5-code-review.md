# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Branch `39-global-dashboard-settings` against base `main` at `bcbc2ab`, implementation commit `2222f07`; 25 changed files, 826 insertions and 102 deletions. Sampled review emphasizes startup, persistence, synchronization ownership, integration adoption, and changed tests.
**Health Score:** 89/100
**Trend:** 90 → 89 (−1) against the previous PR Review record, which reviewed this task's plan rather than its implementation.

The shared persistence and cross-browser synchronization work, but two startup failure paths need correction before merging.

## Reviewed Changes

- Runtime: `public/dashboard-helpers.js`, `public/dashboard-settings-sync.js`, `public/dashboard.js`, `public/dashboard-weather.js`, `public/dashboard-calendar.js`, `public/dashboard-bookmarks.js`, `public/dashboard.css`, `public/index.html`, `src/dashboard-preferences.js`, `src/db.js`, and `src/app.js`.
- Tests: `test/dashboard-settings-api.test.js`, `test/dashboard-settings-sync.test.js`, `test/configuration-observers.test.js`, `test/calendar-api.test.js`, `test/dashboard.test.js`, `e2e/dashboard-home.spec.js`, and `e2e/global-settings.spec.js`.
- Documentation and metadata: `README.md`, `docs/dashboard.md`, `docs/linkwarden.md`, `docs/testing.md`, `package.json`, and `tasks/39-global-dashboard-settings/4-implemented.md`.
- Skipped generated file: `package-lock.json`. No `.brooks-lint.yaml` was present; balanced scoring and all default risks apply.

The review scanned change propagation, cognitive load, duplicated decisions, accidental complexity, dependency direction, domain invariants, and the quick test signals. Shared schema imports are DOM-free, the SQLite store owns revision transactions, and integration identities remain separate from display revisions. Concrete composition dependencies and data-only API records are justified here. Dense asynchronous code raises reading cost, but the findings below focus on demonstrated behavioral consequences rather than line counts.

---

## Findings

### Warning

**R2 — Change Propagation: A settings read failure prevents independent service startup**

Symptom: `public/dashboard.js:183–190` configures and starts photos, weather, calendar, and bookmarks only inside the first successful `onSnapshot` callback. Startup at `public/dashboard.js:338–339` applies cached preferences only to the form, background color, and presentation. A failed initial read in `public/dashboard-settings-sync.js:79` reports an error without delivering a fallback application. A Chromium reproduction with a valid initialized preference cache and a 503 settings response issued only `/api/dashboard/settings`; it never requested photos or calendar status.

Source: *The Pragmatic Programmer* — Orthogonality; *A Philosophy of Software Design* — Information Hiding and Leakage. The independent content owners now depend on successful preference transport rather than the available preference preview.

Consequence: A settings-only failure, including the explicitly supported preference-storage corruption response, leaves a newly opened dashboard without its photo and integration content even when their independent APIs remain usable. The confirmed cache does not provide the documented full startup fallback, and the clock/color preview can conceal that content startup never occurred.

Remedy: Add a once-only presentation/service bootstrap from the validated confirmed cache or deterministic defaults when initial synchronization fails. Keep preview application separate from server confirmation and migration authority, retain disabled unconfirmed saves, and let subsequent snapshots update only changed groups. Add a composed browser regression with a failed settings endpoint and usable photo/integration endpoints; assert startup requests, cached rendering, retry, and no duplicate owners after recovery.

**R2 — Change Propagation: Calendar eligibility depends on metadata availability during cached startup**

Symptom: `public/dashboard.js:188` starts the calendar fallback before applying its preference eligibility. At `public/dashboard.js:193`, a rejected/unavailable observer calls `calendar.configure` only when visibility values changed. If the confirmed cache already contains `calendarVisible: false` and `mobileCalendarVisible: false`, and the first live snapshot repeats those values with calendar metadata unavailable, neither value changed. The controller therefore retains its constructor's `enabled = true` at `public/dashboard-calendar.js:135`. A Chromium reproduction requested `/api/calendar/events` while the calendar element was hidden and both shared visibility flags were false.

Source: *The Pragmatic Programmer* — Orthogonality; *Domain-Driven Design* — Aggregate Roots and invariant ownership. Shared refresh eligibility must hold independently of whether public connection metadata can be observed.

Consequence: A hidden calendar can retrieve events and arm its five-minute refresh timer during a metadata outage. This violates the both-profiles-hidden rule and adds provider work that users explicitly disabled. The defect persists while metadata remains unavailable because repeated unchanged preferences never invoke the fallback configuration path.

Remedy: Apply effective calendar eligibility on initial bootstrap as well as actual visibility changes, before any fallback discovery can proceed to event retrieval. Continue passing source metadata and eligibility together for guarded adoption. Add a browser regression seeded with a confirmed both-hidden cache, an unchanged live preference snapshot, unavailable calendar metadata, and a configured independent calendar status; assert zero event requests through repeated polls and normal resumption after enabling a profile.

### Suggestion

**R6 — Domain Model Distortion: The legacy migration gate accepts invalid content as valid preferences**

Symptom: `public/dashboard-helpers.js:54–58` considers a legacy record migratable when one recognized field merely has the default field's JavaScript type. It does not establish that an enum, timezone, or color contains a valid value. For example, `{ timezone: 'not/a_timezone' }` returns a complete default preference object instead of `null`. A direct synchronization reproduction then sent that default object to `/api/dashboard/settings/initialize` and confirmed revision 1.

Source: *Domain-Driven Design* — invariant ownership and boundary translation; *Code Complete* — Defensive Programming. Recognized field shape is being treated as valid migration content.

Consequence: A corrupt legacy record containing no valid preference can claim the one-time initialization slot with defaults. Another browser's genuinely valid legacy configuration can no longer migrate automatically, even though the goal reserves initialization for valid existing values. This is an upgrade edge case rather than an established-record overwrite.

Remedy: Require at least one recognized semantically valid legacy value before producing a migration candidate. Preserve the intentional clamping and step quantization for finite numeric legacy values, discard invalid fields, and return `null` when no valid content remains. Add invalid-only enum/timezone/color cases and a mixed valid/invalid record case to the migration checks.

---

## Verification And Quick Test Check

- Reviewed all changed paths and the single implementation commit against `main`; generated lockfile content was excluded from analysis.
- Ran `node --test test/dashboard-settings-api.test.js test/dashboard-settings-sync.test.js test/configuration-observers.test.js test/dashboard-calendar.test.js`: 29 passed, zero failures or skips.
- Ran `npm run test:browser -- e2e/global-settings.spec.js`: six passed, including actual bidirectional Firefox/Chromium propagation with isolated storage.
- Executed temporary in-memory server/Chromium reproductions for both startup warnings and a direct synchronization reproduction for invalid-only legacy migration. These checks added no runtime or test files to the project.
- The implementation record reports the earlier passing full runs of 215 Node tests and 60 browser tests. This review reran the focused checks above rather than claiming another full-suite run.
- Tests cover atomic persistence, conflicts, migration races, observer ownership, deadlines, and actual multi-client propagation. Injected providers and clocks are appropriate seams, and primary assertions verify observable behavior. Existing cache tests cover synchronization state, not composed service startup; existing metadata-isolation tests do not cover the cached both-hidden calendar fallback. These gaps explain the passing suite alongside the reproduced warnings.

## Summary

Correct the cached/error startup paths first so independent services remain usable and calendar eligibility always holds. The change spans 25 files and more than 500 added lines, creating a large change-propagation review surface, but the files serve one coherent global-settings feature rather than unrelated responsibilities. There are no Critical findings, two Warnings, and one Suggestion; the balanced score is `100 − 2 × 5 − 1 = 89`. No implementation fixes were made during this review.
