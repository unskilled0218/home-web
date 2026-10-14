# Implemented

## Result

Implemented task 43 on the new branch `43-selected-bookmark-links`. Version changed from `0.17.12` to `0.17.13` in both package manifests. Settings → Bookmarks now provides individual shared link choices; the dashboard shows only confirmed selected links, and native link activation opens a protected new tab in the current browser.

## Changes

- Added `public/bookmark-selection-data.js` for exact bounded selection records and the selected-only dashboard projection. `bookmarkLinkSelections` is `null` for setup or an array of up to 256 unique `{ selectionId, collectionSelectionId }` records; `[]` is intentionally empty. Neither state falls back to displaying the full catalog.
- Extended the existing canonical shared-preference schema, old-record decoding, cache decoding, and revisioned SQLite owner. Reading old records supplies defaults without writes or revision changes. An explicit canonical save persists missing fields; stale/outdated writes cannot erase choices. No new table, storage owner, or polling protocol was added.
- Projected server-issued bookmark IDs from a versioned source/account/provider-ID tuple and added the resolved stable folder identity to folder results. Names, URLs, credentials, and temporary tokens do not affect persistent identity. Existing numeric bookmark IDs and token-authorized folder requests remain supported; persistent IDs do not authorize requests.
- Kept one bookmark controller for catalog and dashboard. Selected folder hints load through collapsed ancestors, picker folder demand is independent from presentation, and empty choices with Settings closed do not fetch all folders. Source/generation fencing, four-request concurrency, token renewal, visibility ownership, and current transport/provider/cache bounds remain in place.
- Added selected-first cache admission and unselected-content reclamation under the existing 10,000-link/8 MiB limits. Confirmed selected records are protected; obsolete unselected results can occupy only residual capacity. Eviction preserves opaque choices, drafts, folder identities, and disclosure metadata; evicted catalog content is explicitly partial/reloadable and does not create an automatic refetch loop. Genuine selected-content overflow and provider truncation remain unresolved with diagnostics.
- Added `public/dashboard-bookmark-selection.js` and scoped picker markup/styles. The picker preserves keyed checkbox drafts across catalog updates, reports the 256-link limit, retains removable unavailable entries, and disables preference edits during saves. Unselected links remain available in the lazy Settings catalog while absent from the dashboard.
- Implemented explicit “Use this folder” repair for a selected bookmark discovered in a different collection. Discovery alone does not change draft or saved hints. Repair changes only the selected draft record, participates in existing conflict/discard handling, and becomes cold-start discovery policy only after Save preferences.
- Updated dashboard coordination without merging connection and preference actions. Dirty revisions, explicit shared reload, independent credential drafts, remote updates, and fullscreen remain intact. The user-directed presentation refinement below moves folder disclosure to Settings and retains the legacy mobile mode only for preference compatibility.
- Dashboard bookmark anchors and Open Linkwarden now use `target="_blank"` and `rel="noopener noreferrer"`. HTTP/HTTPS validation, text-only labels, keyboard activation, and native context-menu behavior remain; no popup script, extension, native launcher, or another-browser selection was added.
- Updated `docs/linkwarden.md` and `docs/testing.md`. Existing all-link browser scenarios now seed explicit selections or inspect the unfiltered picker rather than deleting their regressions.

## Evidence-Driven Adjustment

The first combined maximum-payload test showed that permitting 128-character saved folder hints could exceed the 65,536-byte shared-response budget with 256 bookmark and 256 device choices. Persistent hints therefore validate the server's actual 43-character SHA-256 collection identity format rather than the broader temporary-token/metadata syntax. This field is new, so no existing persisted bookmark choices are rejected by narrowing it. Provider/token formats and response limits were not raised or changed. Maximum canonical selection request size measured 47,306 bytes; the tested snapshot with bounded Linkwarden/calendar metadata measured 51,756 bytes. The maximum-payload regression now passes.

## Verification

- `npm run check`: passed.
- Individually ran `node --check` for every `src/*.js`, `public/*.js`, `e2e/*.js`, and `test/*.js` entry: passed.
- `npm test -- --test-timeout=10000 --test-reporter=spec`: 299 tests, 297 passed, zero failures/cancellations, two skipped; about 9.3 seconds. Skips are the existing real SIGINT/SIGTERM owned-child delivery probes denied with `EACCES`, not bookmark exclusions.
- `PLAYWRIGHT_PORT=43246 npm run test:browser`: all 93 browser tests passed in 55.5 seconds, including the existing Firefox/Chromium shared-settings case. No new browser case was skipped.
- Focused bookmark/schema/API tests covered setup versus explicit empty, exact record validation, maximum counts/bytes, combined legacy decoding, no read-time writes, canonical-save persistence, revision conflicts, database reopen, stable identity through credential/title/destination/folder changes, source/account isolation, unsafe URL filtering, and unchanged token authorization.
- Controller tests covered cold selected descendants, empty-selection request avoidance, picker demand, queue deduplication/concurrency, folder identity rejection, source/generation fences, token renewal, transient/denied content, full-catalog reclamation for remote choices, late selected records, current-policy acceptance, deselection, refetch-loop avoidance, bounded count/bytes, and genuine selected-byte overflow.
- Twelve new real-server browser cases covered filtered subsets with an unfiltered picker, restart persistence, mouse and keyboard loopback popup destinations with `window.opener === null`, unchanged dashboard navigation, two-browser synchronization, dirty-draft conflicts, independent credential fields, moved-hint discovery/repair/discard/conflict/cold-start semantics, transient/missing/source-replacement states, denied-label removal, the 256/257 boundary, pending-save disabling, hidden/persisted-page resumption, and desktop/390px/320px/fullscreen presentation.
- Existing bookmark geometry, nested mobile disclosure, token-renewal focus, empty provider folders, retry, connection independence, and unrelated photo/weather/calendar/device tests remain passing.
- `git diff --check`: passed.

## Scope And Limitations

New and upgraded installations require explicit link selection; full-account display is not inferred. Lazy browsing cannot prove that an unseen or moved link was deleted account-wide. Opaque choices remain saved and may need folder reload or explicit hint repair. Provider truncation and genuinely oversized selected content are reported rather than bypassing bounds. Standard new-tab links use the browser displaying the dashboard, not another installed browser.

Verification used isolated temporary databases, stubbed Linkwarden providers, controlled loopback destinations, and available test ports. No real user account, NFS mount, container policy change, dependency installation, live service shutdown, unrelated runner termination, existing core/log removal, or `todo.md` edit was performed. Archived task 42 review warnings remain outside this implementation. The implementation is committed locally; no push or merge is performed.

## User-Directed Presentation Refinement

After initial implementation, the user requested: “display link under folder like tree view in settings” and “display selected link without parent.” This supersedes the original plan's dashboard grouping requirement without changing selection persistence, identity, cache bounds, or protected new-tab behavior.

- Settings now renders each link checkbox inside its collection's nested details/summary branch, above that collection's child folders. Visible labels show link names; accessible labels retain collection paths for duplicate-name disambiguation. Unavailable choices remain separately removable below the tree. Keyed rows preserve checkbox drafts, moved-link repair actions, and focus across polling or relocation.
- Replaced the dashboard tree renderer with `public/dashboard-bookmark-list.js`. It renders one deduplicated, selected-only flat list with no parent labels or expandable groups, preserving keyed anchor focus, per-link stale/error/retry notices, and protected new-tab navigation.
- Removed the irrelevant visible Compact/Expanded control. The existing `mobileBookmarksMode` value is retained and round-tripped through a hidden preference field so this refinement does not erase legacy settings or change the shared schema. Fullscreen hiding remains available.
- Updated scoped indentation, accessibility markup, documentation, and existing geometry/disclosure tests. Added a real-server regression verifying exact nested Settings ownership, absent dashboard parent labels, and focused checked-row stability after polling.
- Follow-up verification: all 25 focused browser cases passed in 17.5 seconds; the full Node suite passed 297 tests with the same two existing signal-permission skips in about 9.3 seconds. `PLAYWRIGHT_PORT=43248 npm run test:browser` passed all 94 browser tests in 56.7 seconds. `npm run check`, individual public/browser/test syntax checks, and `git diff --check` passed.
- This remains task 43 on its existing implementation branch and version `0.17.13`; no new task, dependency, schema, push, or merge is introduced.

## User-Directed Toolbar Refinement

- Renamed the visible “Select none” action to “Clear” without changing its draft-only clearing behavior or persistence requirements.
- Replaced individual folder reload buttons with one “Reload folder” toolbar button immediately left of Clear. The two buttons stay side by side on desktop and narrow mobile screens. Folder notices point users to the shared action.
- Added `reloadPickerFolders()` to batch disclosed picker folders and saved selected-folder hints through the existing four-request queue. Reload does not clear, save, or rewrite selection/credential drafts, and the button is disabled while folder loads, connection mutations, or preference saves are pending. The selected flat dashboard remains unchanged.
- Added controller and real-server browser regressions for batching, one-button placement at 1200px/320px, draft preservation, clear/save semantics, and save-time disabling. Updated the existing retry and visibility tests for the shared toolbar.
- Verification: all 54 focused Node tests passed; all five focused browser tests passed in 3.8 seconds. The full Node suite passed 298 tests with the same two existing signal-permission skips in about 9.3 seconds. `PLAYWRIGHT_PORT=43251 npm run test:browser` passed all 96 browser tests in 56.9 seconds. `npm run check`, individual JavaScript syntax checks, and `git diff --check` passed.
- This change implements only the requested button label and shared reload placement/behavior. The membership omission and obsolete disclosure suggestion in `5-code-review.md` are not claimed fixed, and the exact live Settings report remains unconfirmed. Task/version remain `43-selected-bookmark-links` / `0.17.13`.
