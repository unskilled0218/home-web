# Implementation

- [Implementation](#implementation)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limits](#limits)

## Changes

- Removed the Information layout fieldset and its Position/Overall scale inputs from Settings > General. Updated General guidance while retaining its scope selector, transfers, recovery, and category footer actions.
- Preserved canonical preference fields, schemas, raw Local/Global stores, category ownership, rendering, and direct layout editing. The existing baseline-based form reader handles absent inputs, so no production JavaScript changes were needed.
- Added Local/Global coordinator regressions for no-change General saves, unrelated category saves, nondefault stored values, populated Desktop/Mobile profiles, and layout-only patches. Added two browser scenarios for control absence, scope round trips, General save/reload preservation, and direct editing with mixed stores.
- Migrated affected browser tests to retained Time/Weather fields and appropriate category selection. Preserved draft, validation, conflict, import-gating, integration-isolation, synchronization, and layout assertions. Legacy presentation tests seed position/scale and assert they survive saves and redirects; form ownership checks now explicitly exclude removed inputs.
- Updated README and dashboard/scope/layout documentation. Synchronized release metadata and notes at `0.17.42`.

## Verification

- Focused Node run: `node --test --test-concurrency=1 test/dashboard.test.js test/dashboard-settings-categories.test.js test/dashboard-settings-scope.test.js test/dashboard-layout-session.test.js` passed all 74 tests.
- `npm run check`: passed on version `0.17.42`.
- `npm test -- --test-concurrency=1`: passed all 656 tests with no failures, cancellations, or skips. Syntax and full Node verification ran sequentially, before browser attempts.
- Independently syntax-checked every `e2e/*.js` file with `node --check`; all passed, including final test migrations.
- Focused browser attempt: `npm run test:browser -- e2e/settings-scope.spec.js e2e/dashboard-layout.spec.js e2e/global-settings-transfer.spec.js e2e/integration-settings.spec.js --max-failures=1` collected 64 cases but stopped at the first Chromium launch failure; 63 did not run. No application/browser behavior was exercised.
- Complete browser-suite attempt: `npm run test:browser -- --max-failures=1` collected 182 cases but stopped at the first Chromium launch failure; 181 did not run. The failure cap avoids repeating the same confirmed environment prerequisite failure, not application failures.
- Chromium launch reports missing `/home/container/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`. Firefox's configured executable is also absent. The user must install matching binaries with `npx playwright install chromium` and `npx playwright install firefox`, then rerun browser verification. No browser/system packages were installed.
- Reviewed active source/tests/docs for obsolete interactions with the removed controls. Remaining position/scale references represent retained schema/rendering behavior, seeded compatibility data, or absence assertions.
- `git diff --check`: passed. The release consistency test passed in the full Node suite, checking version/manifests/README/release notes configuration.

## Limits

- Browser regression scenarios are implemented and syntax-valid but remain unverified at runtime because browser binaries are unavailable. No browser pass is claimed.
- Existing stored position/scale values continue to affect presentation and can still be deliberately replaced through existing Global import behavior. No migration, deletion, or replacement UI was introduced.
- Task 72's integration-draft discard and Calendar auto-close warnings remain unchanged and outside this request.
- No merge, push, deployment, or release publication was performed.
