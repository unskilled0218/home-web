# implemented

## Changes

Implemented task 39 on `39-global-dashboard-settings`. All six Settings categories and both display profiles now use one installation-wide SQLite preference record, with UTC defaults, canonical numeric steps, strict validation, atomic initialization, and revision-checked saves. Existing widget settings and encrypted integration records retain their separate stores.

Added `GET /api/dashboard/settings`, `POST /api/dashboard/settings/initialize`, and `PUT /api/dashboard/settings`. Snapshots include independently available public weather, calendar, and Linkwarden metadata without provider requests or credentials. Calendar configuration identities and captured-source checks prevent obsolete event replies from restoring retired data.

Added one browser synchronization owner with five-second visible-page polling, bounded requests, visibility lifecycle handling, guarded metadata observations, and per-service reference-counted mutation deferral. Valid legacy preferences can initialize an absent record once; confirmed preference caches provide startup fallback without becoming server authority. Cache failures cannot turn confirmed saves into failures, and offline writes cannot claim local-only success.

Settings saves now await server confirmation. Remote changes update the dashboard while preserving open drafts and their captured revisions. Conflicts require explicit Reload shared preferences before reapplying changes. Change-specific application preserves unrelated photo, clock, weather, calendar, and bookmark owners. Weather location comparison ignores JSON property order, preventing unchanged metadata from triggering extra reads.

Weather, calendar, and bookmark controllers adopt remote configuration through request-start guards. Pending integration actions defer only their own metadata while other preferences continue synchronizing. Calendar requests have a 25-second deadline and report unconfirmed mutation outcomes for later status reconciliation. Same-source access blocks remain in place until a changed configuration restores access.

Updated Settings copy, README, and dedicated dashboard, Linkwarden, and testing documentation. Added store/API, synchronization, controller-observer, and real-server multi-client coverage. Updated existing browser fixtures to use shared settings instead of browser-local authority. Bumped the package version and both root lockfile entries from `0.17.8` to `0.17.9`.

## Verification

- `npm run check` passed.
- Separate `node --check` checks passed for all changed and new JavaScript runtime and test modules.
- `npm test` passed: 215 tests, zero failures, zero skipped tests.
- `npm run test:browser` passed: 60 tests, zero failures. The default runner used Chromium; the focused cross-engine test launched actual Firefox and verified saved preferences propagating in both directions through the same server with isolated browser storage.
- Browser coverage includes all Settings categories, desktop/mobile projection, stale drafts and explicit reload, migration races, remote weather/calendar/Linkwarden configuration, and live preference synchronization during a pending calendar connection.
- Reviewed the implementation diff and ran `git diff --check` successfully. Firefox was installed by the user in the container; no system installation was performed during implementation.
