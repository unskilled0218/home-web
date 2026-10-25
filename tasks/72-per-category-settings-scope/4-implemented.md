# Implementation

- [Implementation](#implementation)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limits](#limits)

## Changes

- Added one complete/disjoint ownership policy for all 48 preference keys across eight categories and a strict browser-only category-scope schema.
- Replaced whole-dashboard mode with independent Local/Global sources, category epochs, opaque revision tokens, separate raw stores, and a validated effective projection. Legacy mode migration remains read-only.
- Added category-only saves and drafts, category Save/reload labels, per-panel selectors, and widget-owned visibility/fullscreen controls. General owns both layout profiles; layout saves send only a layout patch. The footer accommodates longer category labels, and Home Assistant has an explicit connection-draft discard action.
- Added persisted-map mutation admission for preference/layout/location writes, installation mutations, and Global import, including dispatch-boundary rechecks. Category-specific guards preserve shared server resources and ordinary Wake behavior.
- Added confirmed corrupt-map-only recovery that preserves saved records and unsaved drafts while invalidating captured tokens. Concurrent repairs and storage failures prevent replacement.
- Routed weather through Weather scope while preserving Time formatting, and images through Images scope while preserving Local Global-follow opt-out. Unrelated scope changes retain photo owners.
- Kept Global API/transfer schemas unchanged and made transfer controls consume raw Global state. Added ownership, admission, recovery, mixed-store, browser, and compatibility coverage; migrated affected existing browser scenarios.
- Updated README, settings/layout/weather/photo/integration documentation, and release metadata to version `0.17.41`.

## Verification

- `npm run check`: passed on version `0.17.41`.
- `npm test -- --test-concurrency=1`: passed all 654 tests, with no failures, cancellations, or skips. Verification was sequential to avoid the previously observed native Node child instability.
- Focused browser run across category scope, devices, home, display options, layout, transfers, and selected bookmarks, excluding Firefox cases: passed all 147 tests before the final connection-draft discard case was added.
- Final `npm run test:browser`: 178 passed, 2 failed out of 180. Both failures occur at Firefox launch because `/home/container/.cache/ms-playwright/firefox-1543/firefox/firefox` is absent. The user must install Firefox with `npx playwright install firefox` to verify those two cross-browser cases; no browser/system packages were installed by this task.
- All nine category-scope browser cases passed in the final suite, including reverse mixed scopes, General layout/raw-store isolation, and explicit Home Assistant draft discard. The separate integration form admission/guard case passed too.
- The first complete browser migration run had 151 passes and 26 failures. Corrected affected fixtures, obsolete full-object-write expectations, duplicate installation metadata discovery, reload waits, and long-label footer layout. The final run has no observed Chromium behavior failures; the earlier baseline conflict-message, focus, and fullscreen failures do not remain.
- `git diff --check`: passed. Release version, npm manifests, README, release notes, and configured notes path agree on `0.17.41`.

## Limits

- Local storage is not a cross-tab compare-and-swap transaction. Admission cannot roll back a server operation after dispatch or reconstruct unobserved source transitions.
- Preference revisions remain store-wide; another category's same-store save can require explicit draft reload. Scope-only changes in an unrelated category do not invalidate the target source.
- Installation credentials/devices remain server-owned. Category scope is a UI configuration choice, not server authorization.
- No merge, push, deployment, or release publication is part of this implementation.
