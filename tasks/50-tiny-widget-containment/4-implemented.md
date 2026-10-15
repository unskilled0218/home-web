# Implementation

## Table of Contents

- [Outcome](#outcome)
- [Changes](#changes)
- [Verification](#verification)
- [Scope and Limits](#scope-and-limits)

## Outcome

Implemented task 50 on the newly created branch `50-tiny-widget-containment`, version `0.17.19`. All six custom widgets now retain their projected border-box dimensions on positive tiny surfaces, including one-pixel axes. Preview decoration no longer enlarges scaled boxes or offsets their coordinate area. This addresses warning 2 from the task 49 code review; polling/editor ownership warning 1 remains unchanged and unresolved.

## Changes

- `public/dashboard-layout-view.js` publishes the projected card width and height as presentation-only `--widget-width` and `--widget-height` variables. Automatic-mode restoration removes both variables with the existing absolute geometry properties.
- `public/dashboard.css` bounds each padding edge to the lesser of `.5rem` and one quarter of that axis's projected size, with zero card border. Padding contracts independently per axis and never consumes more than half an axis. Normal cards keep their existing spacing, scrolling, wrapping, stacking, and bottom-left placement. Preview frame/card borders are replaced with inset shadows, preserving decorative boundaries without contributing to layout dimensions.
- The pure model, coordinate schema, editor JavaScript, synchronizer, server, and persistence implementation are unchanged. No minimum was raised, no positive surface was disabled, and no new production test seam was added.
- `test/dashboard-layout.test.js` adds independent one-pixel-axis fitting and exact normal → tiny → normal projection recovery without source mutation. `test/dashboard-layout-view.test.js` checks variable updates and Automatic cleanup; its fake style removal now distinguishes custom properties from camel-cased standard properties.
- `e2e/dashboard-layout.spec.js` adds three browser scenarios with a test-only `EventTarget` visual viewport installed before normal application initialization. The fixture retains production markup, CSS, controllers, observers, and animation frames against owned real-server/SQLite storage. Assertions explicitly establish the usable surface and compare every actual card rectangle with model projection using a 0.1px tolerance and named rectangle diagnostics.
- Browser coverage includes desktop/mobile live profiles, both editor profile selections, root font sizes 16px and 24px, edge anchoring, intentional overlap, layers, one-pixel and independent-axis surfaces, and a subpixel scaled preview on a 1×1000 surface. Shrink/expand and zero-width/zero-height recovery preserve exact canonical preferences and revision with no resize PUTs. An explicit no-op save additionally verifies the recovered editor submits the unchanged canonical preferences. Custom → Automatic → Custom checks style cleanup and restored projection. Existing native viewport, scrolling, pointer/touch, fullscreen, ownership, and persistence assertions remain intact.
- `docs/dashboard-layout.md` explains shrinking decorative padding and the distinction between one-pixel containment and readable content. `docs/testing.md` records the deterministic coverage and its measurement limits. Both package manifests now identify `0.17.19`; dependencies are unchanged.

## Verification

- Before the production fix, `PLAYWRIGHT_PORT=43325 npm run test:browser -- e2e/dashboard-layout.spec.js --grep 'tiny live|tiny preview'` failed both new scenarios. A projected 1px-wide Calendar rendered 16px wide, exceeding the expected width by 15px. The 1px preview card rendered 2px wide, with the frame border also shifting its X coordinate by 1px. These were actual DOM rectangle failures, not model-only or clipping assertions.
- `node --test test/dashboard-layout.test.js test/dashboard-layout-view.test.js`: 30 passed, zero failures/skips.
- Initial focused `PLAYWRIGHT_PORT=43326 npm run test:browser -- e2e/dashboard-layout.spec.js`: 16 passed, zero failures/skips, about 17.5 seconds. The later subpixel-scaled preview case was included in the final full run.
- Final `npm test -- --test-timeout=10000`: 391 passed, zero failures/skips, about 10.6 seconds. Node's default discovery includes four fixture-module entries in that count.
- Final `PLAYWRIGHT_PORT=43327 npm run test:browser`: 118 passed, zero failures/skips, about 1.5 minutes. This includes all 16 layout scenarios, original Automatic-mode regressions, and Firefox/Chromium sharing cases.
- Additional `PLAYWRIGHT_PORT=43328 npm run test:browser -- --browser=firefox e2e/dashboard-layout.spec.js --grep 'tiny live|tiny preview|tiny and zero'`: all three new scenarios passed in Firefox, zero failures/skips, about 5.3 seconds.
- `npm run check`, individual `node --check` for all four changed JavaScript files, and `git diff --check` passed. No browser installation or privileged environment change was needed.

## Scope and Limits

The controlled viewport is a deterministic measurement fixture, not physical-device visual viewport emulation. Existing native viewport/fullscreen/touch tests provide complementary integration coverage. A one-pixel widget is guaranteed to fit and recover, not to present readable content or a useful drag target; the existing widget selector and numeric controls remain available when editing space permits.

The plan was implemented without changes to stored geometry, preference schemas/revisions, migrations, save ownership, dependencies, legacy layouts, user configuration/data, live services, or `todo.md`. Tests use owned temporary storage and injected/intercepted provider actions; no real Wake dispatch, NFS mount, or integration account was used. No push, merge, release, image build, or publication was performed. The implementation and this results report are committed together on the task branch.
