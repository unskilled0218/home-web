# Implementation

## Table of Contents

- [Outcome](#outcome)
- [Changes](#changes)
- [Safety and Ownership Evidence](#safety-and-ownership-evidence)
- [Regressions Found During Verification](#regressions-found-during-verification)
- [Verification](#verification)
- [Limits and Scope](#limits-and-scope)

## Outcome

Replaced the Settings layout preview with the sole direct dashboard layout editor on branch `52-direct-dashboard-layout-editing`, created from task-bearing commit `89cec04`. Application version is `0.17.21` in both manifests, with no dependency changes. Long press and the keyboard-accessible Edit layout button enter a marked local edit session. The existing shared preference writer, complete revision contract, normalized version-2 geometry, reference owner, providers, and live widget nodes remain authoritative.

## Changes

- `public/dashboard-layout-activation.js` delegates one cancellable 600ms hold timer, rejects interactive composed-path descendants and noncollapsed selections, cancels at 8 screen pixels or lifecycle/scroll/second-pointer interruption, rechecks visibility/hit eligibility, and narrowly suppresses the consumed release/click/context menu. Scheduling is injected for deterministic tests; normal holds neither capture pointers nor prevent scrolling.
- `public/dashboard-layout-session.js` isolates the complete immutable entry baseline, revision, two canonical profile drafts, selection, deterministic Automatic templates, field-specific geometry/layer edits, and save payload construction. No-op, clamped, and canceled operations do not materialize Custom.
- `public/dashboard-layout-editor.js` now owns only direct editing chrome/session/input/gesture lifecycle. It projects local drafts onto existing live nodes while keeping real widget roots inert. Unscaled frames expose move/upper-right resize handles; toolbar controls provide numeric/keyboard edits, profiles, covered/hidden widget selection, layers, Automatic reset, explicit Reload, Save, Cancel, and fullscreen. Pointer previews derive from a fixed canonical start and actual fit scale. Cancellation restores exact pre-gesture data.
- `public/dashboard-layout-view.js` retains confirmed state independently from a pinned-profile local override and exposes the shared reference/fit measurement used by frames. Toolbar measurement reduces destination space, not frozen reference dimensions. Clearing the override restores the newest confirmation, then releases the single edit lock. Settings no longer acquires that lock.
- `public/dashboard.js`, `public/index.html`, and `public/dashboard.css` remove the Settings fieldset, obsolete preview markup/styles, draft-loading/saving callbacks, and validation coupling. Settings retains its complete baseline layout when saving unrelated preferences. Edit/Settings entry is exclusive. The injected Wake dispatcher and narrow capture guards reject edit-time actions without changing row-owned pending state. Fullscreen retains Edit layout and the existing all-hidden tools exception.
- The original 22 browser layout scenarios migrate to direct controls or retain view-only assertions; no layout scenario was skipped or deleted. Additional activation/session/view unit tests and real-browser tests cover new safety/state ownership. The fullscreen home regression now asserts the intentionally visible edit entry while other immersive tools remain hidden. Static tests require unique direct controls, separate native form ownership, and absence of the Settings preview.
- `docs/dashboard-layout.md`, `docs/dashboard.md`, and `docs/testing.md` describe direct editing, temporary Automatic templates, references, keyboard controls, blocked actions, complete revision saves, offline/reload recovery, and browser limits. Historical task records remain unchanged.

## Safety and Ownership Evidence

- Real-server request/revision assertions prove zero PUTs for Automatic entry, selection, no-op Save, refitting, Cancel, and lifecycle interruption. A changed save includes the complete captured preferences, untouched profile, and entry revision. Stale saves receive the existing 409 without replacing local geometry or rebasing their payloads. Explicit Reload discards both profile drafts and raw inputs; offline drafts remain nonwritable after background confirmation until that Reload.
- Polling regressions retain focused valid/invalid raw inputs and active pointer capture across unchanged, failed, and remotely changed snapshots. Only true writes disable mutation. Removing the old Settings editor supersedes its layout-specific polling/draft-loss path; the replacement has direct regression evidence. This does not claim a general synchronization/integration refactor or resolution of unrelated historical warnings.
- A real stubbed Wake starts before entry, retains its exact button and sensor row, and completes while roots remain inert and the draft is active. Stale synthetic button/link/key events and a real pointer hit cannot dispatch another Wake or open a popup. Exactly one initial Wake POST occurs during editing. After exit, bookmark popup navigation and an explicit Wake POST resume; the existing server cooldown still prevents duplicate dispatch. Provider read and clock/slideshow owner counters remain stable through layout-only changes.
- Browser geometry assertions compare live cards and all six unscaled frames with one reference projection/fit, including independent one-pixel axes, both profiles, font sizes, all-hidden placeholders, zero surfaces, and recovery. Minimum-clamped moves, no-net/canceled gestures, field isolation, bottom anchors, reference locking, fullscreen confirmation, and weather wrapping retain prior coverage.
- Pending writes disable all mutation/reload/exit controls and keep action blocking until success/failure. The isolated real-DOM owner test verifies one reference acquisition/release, restoration of prior inert values, complete captured save payloads, idempotent disposal, and rejection of late save completions. Persisted-page lifecycle simulation cancels only a held gesture and retains earlier local edits, lock/reference geometry, and action blocking without writes.

## Regressions Found During Verification

- Initial static/fullscreen tests expected the old fully hidden tools header. They now require the fullscreen Edit layout entry while preserving immersive hiding of Settings/fullscreen buttons and all-hidden exceptions.
- A temporary `tabindex` removal could drop focus asynchronously, especially in Firefox. Exit now restores already-focusable origins or uses the persistent Edit layout fallback after removing a temporary widget anchor. No temporary attributes leak. This is a small cross-engine adjustment to the planned focus-restoration mechanism, not a retained hidden focus node.
- Captured-gesture cancellation re-rendered selectors before consuming their changed values. Profile/widget/arrangement changes now capture the requested value first, then cancel/validate and apply it. A browser regression selects a profile during capture and verifies the old gesture is discarded without losing earlier edits.
- The first new threshold test used an advancing fake clock, and repeated trusted text clicks could leave selections. Tests now pause the threshold clock exactly and isolate context-menu dispatch from native text selection rather than weakening activation's copy-gesture guard.
- Release suppression initially relied too broadly on a reused mouse pointer ID. It now follows the actual release location, accepts only the matching sequence, and clears on the next real pointerdown. A deterministic regression rejects unrelated locations/IDs and proves a later click works even when the browser emitted no compatibility click.
- A clean-Settings test could dirty the form before the opening GET and subsequent poll had delivered the new revision. It now waits for actual cached confirmation before editing; three repeated real-server runs pass rather than treating fake-time advancement as proof of network completion.
- A native 160 × 150 window exposed Save clipping when the sticky header also contained the long mode label and recovery controls. Only the compact Save/Cancel row is sticky now; the label/recovery controls scroll below it. Actual 320 × 240 and 160 × 150 window tests verify safe exit and unchanged revisions, separately from controlled tiny-canvas measurement.
- The inherited minimum-clamp browser fixture assumed Chromium's screen dimensions and pointer ID. It now explicitly controls each test screen and captures the actual pointer ID, preserving the same canonical-size/cancellation claims in Firefox instead of encoding engine defaults.

## Verification

- `node --test test/dashboard-layout-activation.test.js test/dashboard-layout-session.test.js test/dashboard-layout.test.js test/dashboard-layout-reference.test.js test/dashboard-layout-view.test.js`: 68 passed, zero failed/skipped/canceled.
- `npm test -- --test-timeout=10000`: 429 passed, zero failed/skipped/canceled.
- Focused Firefox run with `PLAYWRIGHT_PORT=3213`, `--browser=firefox`, and the ten mouse/polling/keyboard/lifecycle/short-window/minimum-clamp/frame/reference/weather cases: 10 passed, zero skipped. The Chromium suite also retains the actual Firefox/Chromium shared-layout exchange.
- `npx playwright test --browser=chromium`: 136 passed, zero skipped, including all 34 direct-layout scenarios, retained Settings/integration/Automatic regressions, and the actual Firefox/Chromium exchange. The separately repeated clean/dirty Settings scenario passed 3/3, and the strengthened pending-Wake/detached-handler/bookmark scenario passed 1/1.
- `npm run check`: passed. All 11 changed/new JavaScript files passed individual `node --check` invocations. Both manifest versions match `0.17.21`. `git diff HEAD --check`: passed.
- Active `public/`, browser tests, and documentation contain no obsolete Settings preview selectors or instructions. The retained `public/home-layout.js` and `/api/home/settings` functionality were not removed.

## Limits and Scope

Chromium trusted mouse and CDP touch input verify desktop-browser behavior, including native internal touch scrolling; pen input is covered by deterministic pointer-state tests only. Physical pen/touch hardware, mobile Safari callouts, OS/browser-chrome shortcuts, and guaranteed real BFCache admission were not tested. The persisted-page regression deliberately dispatches browser lifecycle events and does not claim guaranteed navigation recovery. Tiny destinations preserve containment and numeric alternatives, not readable content or usable pointer handles at every size.

Verification uses owned temporary real servers/SQLite stores, stubbed providers/actions, and loopback popups. No real Wake packet, live provider account, NFS mount, user data/configuration edit, privileged installation, push, merge, release, image publication, or live-service operation was performed. `todo.md` and historical task documents remain untouched.
