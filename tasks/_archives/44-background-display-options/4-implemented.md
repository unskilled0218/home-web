# implemented

## Changes

Task 44 is implemented on the new branch `44-background-display-options` at version `0.17.14`. General now has Display on background with independent Desktop/Mobile checkboxes for all six sections. Existing Time/Weather/Calendar preferences are reused; six new booleans default to true only when absent in stored records/caches. Complete writes remain strict and revision-checked.

`public/dashboard-display.js` derives effective visibility, wrapper presence, grid tracks/device rows, and the background-only fullscreen exception. Its DOM-only application is used by photo-caption callbacks without controller configuration, request work, preference writes, or clock resets. Lifecycle presentation retains existing controller ownership. Hidden sections retain connections, selections, snapshots, and pending Wake ownership; photos remain independently configured.

Updated preference/schema/cache tests, added all-combination display checks and real-server browser coverage, adapted moved-control regressions, and documented the behavior in dedicated existing docs. No dependencies, provider scheduling, archived review remedies, `todo.md`, or user data were changed.

## Verification

- `npm run check`: passed. Changed/new JavaScript is also syntax-checked individually because the existing wildcard command does not guarantee every file is checked.
- `npm test -- --test-timeout=10000 --test-reporter=spec`: 303 passed, zero failed, two explicit signal-permission skips, 305 total; about 9.3 seconds.
- `PLAYWRIGHT_PORT=43251 npm run test:browser`: all 102 browser tests passed, including the real Firefox/Chromium exchange case; about 1.2 minutes. New coverage includes every checkbox in each profile, database restart, draft/confirmation separation, shared conflict/reload behavior, mixed layout boundaries, additive fullscreen policy, repeated slideshow captions with stable clock interval identities, and a pending stubbed Wake hidden/re-enabled without duplicate dispatch or lost audit.
- Existing maximum preference payload tests passed with the six additional booleans and maximum bookmark/device choices under 65,536 bytes. Schema upgrade tests preserve existing false values/selections and revision 7 on reads, reject incomplete/invalid writes, and persist canonical choices across reopening.
- Initial focused runs caught outdated geometry/tab/label expectations after the controls moved, an incorrectly shaped photo test manifest, and an asynchronous fullscreen-entry race in a test. These test issues were corrected; subsequent focused checks and the full suites passed. No regressions were removed or skipped to accommodate the new controls.
- `git diff --check`: passed. Tests use temporary owned SQLite databases, loopback servers, injected providers, intercepted photo data, and stubbed Wake dispatch; no live account, real NFS mount, broadcast packet, user database, or unrelated process cleanup was used.
- After strengthening mixed-layout bounding-box/overlap assertions, reran all five new background-display browser tests: five passed in 13.3 seconds. Individual syntax checks for all eleven changed/new JavaScript files passed.

## Limits And Scope

The two OS signal delivery probes skip because this container returns `EACCES`; IPC and terminal lifecycle tests pass. npm signal forwarding still reports the known `EACCES` limitation; direct `node scripts/dev.js` remains the verified fallback. This task does not change shutdown ownership or resolve task 42 warnings, task 43 duplicate-membership/disclosure findings, or the user's unconfirmed live Settings-folder report. Background visibility changes keep existing integration polling semantics rather than introducing demand-based suspension. No push or merge is performed.
