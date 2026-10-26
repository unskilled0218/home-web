# Implementation

- [Implementation](#implementation)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limits](#limits)

## Changes

- Added six canonical preferences: `bookmarksScale`, `mobileBookmarksScale`, `homeAssistantScale`, `mobileHomeAssistantScale`, `wolScale`, and `mobileWolScale`. Defaults are 1, with saved values constrained to 0.5–2 in 0.1 steps. Display projection selects mobile values at widths up to and including 600px and desktop values above that breakpoint.
- Added desktop/mobile scale controls in Bookmarks, Home Assistant, and Wake-on-LAN, using their existing category-driven form, dirty-draft, Save/Reload, and Local/Global ownership paths. General and layout-editor controls remain unchanged. Scale saves preserve selections, other categories, the opposite store, and both layout profiles.
- Added missing-scale defaults to stored database/shared-cache decoding and a narrow shared scale-compatibility decoder for persisted Local records and version-1 transfers. Local reads now use a separate stored-record decoder; newly constructed Local saves and current preference writes/snapshots remain strict. Compatible reads preserve records/revisions without writing, and invalid present values or missing unrelated fields still fail validation. Export/import retains its envelope, limits, and revision guards.
- Added widget-root CSS variables and inherited descendant typography for bookmark links, headings/status/retry labels, Home Assistant names/readings/timestamps, and Wake names/buttons. Scaling works in Automatic and Custom DOM placement without applying Information's retained overall scale, transforming widget roots, or rewriting canonical geometry/layers. Existing scale-1 typography and Settings/editor sizing remain intact.
- Resolved plan-review W1 with a dedicated CSS/view update path for scale-only snapshots. Existing startup/breakpoint presentation calls reuse the scale helper, while scale-only saves/confirmations do not call `startClock()` or provider configuration. Time-format changes still take their existing branch, including snapshots that also change a new scale.
- Added focused Node coverage for all scale fields, strict validation, absent-only upgrades, category ownership, Local offline persistence and storage-event rereads, source/token isolation, database/cache compatibility, and transfer round trips. Updated the existing exact display-projection expectations for the expanded contract.
- Added nine browser cases with populated deterministic bookmarks, sensor readings, and a managed Wake device. They check actual descendant computed sizes, native invalid-scale rejection, unrelated invalid-category drafts, explicit Save/discard, Local/Global isolation, reload/server restart, scope switches, desktop/intermediate/mobile and 600/601 boundaries, scale extremes, Custom bounds, pristine editor entry, unscaled chrome, interval creation/clearing, retained photo/action DOM, provider call counts, and combined Time/scale updates. Wake execution is a refusing fixture, not a real packet sender.
- Updated README, dashboard/layout/scope/transfer documentation, release notes, and synchronized release metadata to `0.17.44`. No database schema, endpoint, storage envelope, or layout schema changed.

## Verification

- Focused Node run across widget scales, dashboard/display, category/API/sync/scope/transfer, and layout geometry/Automatic/editor/session/view/reference/activation tests: all 195 cases passed.
- `npm run check`: passed on version `0.17.44`.
- `npm test -- --test-concurrency=1`: all 676 cases passed, with no failures, cancellations, or skips, in approximately 49 seconds. These checks ran sequentially before the final focused/full browser verification.
- `npm run test:browser -- e2e/widget-scales.spec.js e2e/background-display-options.spec.js e2e/settings-scope.spec.js e2e/dashboard-layout.spec.js`: all 80 cases passed in approximately 2.5 minutes, including the dedicated Firefox/Chromium canonical-layout scenario.
- First complete browser run: 199 passed and one existing test failed because it expected only three mobile numeric scale controls. Updated that exact expectation to include all six controls with the three new defaults of 1; no production change was needed for that failure.
- Final `npm run test:browser`, with a 600-second command allowance: all 200 cases passed in approximately 4.7 minutes, including both dedicated Firefox cross-browser scenarios. No browser/system packages were installed.
- During test development, corrected an obsolete Node projection expectation and browser-fixture assumptions about paused animation frames, resize settling, and absent Local selections after scope switching. The final tests retain native validation, full geometry assertions, and the complete suite; no failures were skipped or suppressed.
- Release-consistency checks passed within the full Node suite. `git diff --check` passed before committing.

## Limits

- Scale controls change content typography and natural wrapping, not saved card rectangles or dashboard track allocation. Large content uses existing overflow/scrolling behavior. Information overall scale remains limited to its existing widgets.
- Compatibility defaults only absent new scale fields at the relevant stored/import boundaries. Older open clients must reload before saving the expanded current preference schema. Existing legacy normalization behavior remains unchanged.
- Browser verification covers the configured Chromium suite and dedicated Firefox scenarios, not every new scale case independently under Firefox or every physical device/browser configuration.
- Unrelated integration-draft discard and Calendar auto-close warnings remain unchanged. No merge, push, deployment, or release publication was performed.
