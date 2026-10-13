# implemented

## Changes

Implemented task 40 on `40-home-assistant-wol-settings`. Settings now has eight accessible tabs, including Home Assistant connection setup/update/disconnect and Wake-on-LAN saved-device list/create/edit/delete. Both panels use the current tab navigation and fit desktop and 320px/390px mobile layouts. They do not add Home Assistant readings, entity controls, wake buttons, automatic wake actions, or retired widgets.

Added focused Home Assistant and Wake-on-LAN controllers plus a small shared configuration-request owner. Existing backend APIs, encrypted Home Assistant credentials, SQLite devices, and deletion behavior remain unchanged. Requests use same-origin credentials, explicit status/204 handling, response-shape validation, twelve-second deadlines, duplicate-mutation guards, and stale-read ownership. Successful mutations remain confirmed even when a follow-up read fails. Mutations never retry automatically; uncertain outcomes are reconciled by later reads.

Added a single dialog-scoped integration scheduler with independent per-service read coalescing. It reads on opening/resumption and ticks every five seconds while Settings and the page are visible. Closing, hiding, and persisted-page suspension invalidate old reads without canceling submitted mutations. Non-persisted page exit disposes controllers. Existing global display-preference and active-dashboard synchronization are unchanged.

Forms maintain separate dirty drafts and session/editor ownership. Remote reads update public status and device rows without overwriting dirty input or replacing focused rows. Remote device changes/deletion warn without silently creating a replacement. Affected fields lock during mutations; unrelated forms, preferences, tabs, and Close remain usable. Late old-session completions update confirmed controller state but cannot reset a reopened editor, post an old action message, or move its focus. Home Assistant token input is never saved in browser storage or exposed in public state; successful connection actions and closing clear it. Browser URL/token guidance matches existing origin eligibility and canonical default-port/trailing-slash behavior, while the server remains authoritative.

Confirmed device deletion warns that associated wake audit records are also deleted, retaining the existing database cascade. Reads/edits preserve existing wake timestamps and audit history. Configuration writes retain existing last-successful-write semantics; no new revision protocol or database migration was introduced.

Added controller/scheduler tests and real-server browser coverage using temporary file-backed SQLite databases, injected Home Assistant behavior, and isolated browser contexts. Coverage includes persisted existing data and restart, credential reuse/re-authentication/failures, device CRUD/optional fields/validation/duplicate MAC, confirmed audit deletion, draft ownership, stalled APIs, visibility/persisted-page lifecycle, keyboard/focus/mobile layout, and token omission. Updated existing dashboard assertions to include the new panels and assets without permitting retired widget interfaces.

Fixed the browser runner's post-test hang discovered during implementation: this container denies OS process signals, so Playwright's former web-server teardown stranded processes after tests completed. `e2e/server-setup.js` now starts the production server through IPC and invokes its existing shutdown handler without OS signals, following the existing Node test convention. `PLAYWRIGHT_PORT` supports an alternate free port when an interrupted older runner still owns the default. Production startup and shutdown code were not changed.

Updated README and dedicated dashboard, Home Assistant, Wake-on-LAN, and testing documentation. Bumped `package.json` and both root lockfile version fields from `0.17.9` to `0.17.10`, matching the existing task release convention. Added no runtime dependencies or system packages.

## Verification

- `npm run check` passed. Separate `node --check` checks also passed for every public JavaScript module and new/changed test/config modules.
- `npm test` passed: 232 tests, zero failures and zero skipped tests.
- `PLAYWRIGHT_PORT=3212 npm run test:browser` completed and exited normally: 68 passed, one failed solely because the existing Firefox cross-engine test requires missing `/home/container/.cache/ms-playwright/firefox-1543/firefox/firefox`. All nine new integration tests passed, as did existing Chromium dashboard/global-setting cases. The operator must run `npx playwright install firefox` before full-suite cross-engine verification can pass; no test was skipped or weakened.
- A final focused `PLAYWRIGHT_PORT=3212 npm run test:browser -- e2e/integration-settings.spec.js` passed all nine tests in approximately seven seconds with normal IPC server teardown.
- `git diff --check` passed.

## Environment Notes

Older interrupted Playwright processes still own ports 3210 and 3211. Attempts to terminate these exact test processes returned `Permission denied`; no elevated or broad process-kill operation was attempted. Verification used port 3212. An operator with permission can stop the older runners; the new runner does not reproduce their shutdown hang.
