# Task 32: Prevent Stale Integration Startup Crashes

## Objective

Prevent the deployed home page from aborting during `createHomeIntegrations()` when a browser loads integration JavaScript from the preceding release alongside current HTML, and verify that integration settings remain usable after deployment.

## Request and Scope

- Source: `~/workdir/command.md`: the deployed server reports `Uncaught TypeError: can't access property "addEventListener", document.querySelector(...) is null` from `createHomeIntegrations` in `home-integrations.js`.
- Apply the fix to the home page at `/` and its static-delivery behavior. Do not change the independent `/dashboard` feature behavior.
- Preserve the simplified integration controls introduced by `fdf7150`; do not visibly restore the removed Wake-on-LAN search, bulk-wake, add-device, or duplicate Home Assistant settings controls.
- Preserve current Linkwarden, Home Assistant, Wake-on-LAN, settings-dialog, focus-restoration, and widget lifecycle behavior.

## Inspected Context

- Task 32 is the next number after inspecting `<project>/tasks/`; this is a new plan and does not reuse an earlier task.
- The current worktree is clean on `main`. This planning task must add only this plan.
- The stack's reported `home-integrations.js:316` is not the current line 316. In the parent of commit `fdf7150`, line 316 was `document.querySelector('#new-device').addEventListener(...)`; current `public/index.html` intentionally no longer contains `#new-device`.
- That preceding module also expects `#search`, `#wake-selected`, and `#home-assistant-settings`, all removed by the same refactor. Restoring only `#new-device` would move the crash to the next stale selector rather than solve mixed-version startup.
- Current `public/home-integrations.js` and `public/index.html` agree on their required selectors. The unit-test document in `test/home-widgets.test.js` fabricates every queried selector on demand, so it cannot detect missing real markup.
- `src/app.js` serves every public asset with `Cache-Control: no-cache`. Although this requests revalidation, the deployed evidence shows that clients or an intermediary can still pair HTML and an ES module from adjacent releases. There are no content-hashed asset URLs or a browser startup test that fails on uncaught exceptions.
- `e2e/home-layout.spec.js` loads `/` and exercises layout editing, but it does not explicitly collect `pageerror` events or open each integration dialog. `test/dashboard.test.js` verifies that static files are served but does not verify home-page selector compatibility or cache policy by resource type.
- The current package version is `0.17.1`; this focused deployment fix should become `0.17.2` in both package manifests.

## Compatibility Design

- Keep the current visible UI and current integration controller as the source of truth. Do not weaken current required-element access with broad optional chaining, because silently skipping a genuinely required current control would leave a partially initialized page.
- Add a temporary, explicitly documented hidden compatibility container to `public/index.html` containing the complete set of controls required by the immediately preceding `home-integrations.js`: `#new-device`, `#search`, `#wake-selected`, and `#home-assistant-settings`. Use the same element types expected by the old handlers, keep the container inaccessible and non-visible, and avoid duplicate IDs with current controls.
- Treat the compatibility container as a one-release deployment bridge. The old module can attach handlers and read default values without crashing, while users continue through the current Home Settings integration controls. Document the removal condition in code: remove the bridge only after the compatibility release has been deployed long enough that the preceding assets are no longer served or cached.
- Strengthen static response policy so HTML and JavaScript are not stored across releases. Serve executable/entry markup with `Cache-Control: no-store`; retain an appropriate existing policy for immutable-independent media where caching is useful. Do not add package-version query strings only to `app.js`, because its relative ES-module imports would remain independently cacheable and could still produce a mixed module graph.

## Implementation Steps

1. Create `tasks/32-prevent-stale-integration-crash/3-implemented.md` before implementation edits and record the exact historical/current selector comparison, changes, tests, and any browser limitations.
2. Add the hidden previous-release compatibility controls to `public/index.html` with a succinct removal-condition comment. Keep all four old selectors together and ensure they cannot appear in accessibility, tab, or visual layout.
3. Refine `serveStatic()` in `src/app.js` to apply `no-store` to home/document and JavaScript module responses so a reload cannot reuse a stored module graph from an earlier deployment. Preserve MIME types, containment checks, `X-Content-Type-Options`, 404 behavior, and photo-specific response handling.
4. Add a small test seam only if necessary to classify static response cache policy without duplicating server logic. Avoid introducing a build pipeline, service worker, generated asset manifest, or broad defensive DOM helper for this focused fix.
5. Extend static and browser regression coverage so the real home markup satisfies both the current controller and the immediately preceding release's removed selector surface, page initialization emits no uncaught exception, and each current integration settings launcher opens its intended dialog.
6. Update operational documentation only if it currently makes a conflicting cache/deployment claim. Bump `package.json` and `package-lock.json` from `0.17.1` to `0.17.2`.
7. Run focused, full, syntax, and browser checks; update the implementation record factually; and commit only intended Task 32 files.

## Verification Plan

- Extend `test/dashboard.test.js` to fetch `/`, `/app.js`, and an imported module such as `/home-integrations.js`, asserting the chosen non-storing cache policy and unchanged content types/security headers.
- Add a real-markup assertion that all current required integration IDs exist exactly once and that the four previous-release compatibility IDs exist inside a hidden, inert compatibility container. This must fail if a control is removed without updating its controller or compatibility contract.
- Add or extend Playwright coverage to register a `pageerror` listener before `page.goto('/')`, wait for initialization, and assert no errors occurred.
- In Playwright, open Home Settings and exercise the Bookmarks, Home Assistant, and Wake-on-LAN launchers, asserting the matching dialog opens and closes without a null-selector exception. Stub or tolerate integration API responses using the existing server behavior without requiring real external services.
- Add a mixed-version browser check by substituting or evaluating the immediately preceding module's startup selector accesses against current markup, proving all four removed selectors resolve and accept the old event/value operations. Keep this fixture narrowly scoped to the known adjacent release rather than maintaining arbitrary historical JavaScript.
- Run `node --test test/dashboard.test.js test/home-widgets.test.js`, then `npm test`, `npm run check`, `npm run test:browser`, and `git diff --check`.
- If no browser executable is available, report that limitation and do not claim native browser reproduction; retain the server and markup regression tests.

## Acceptance Criteria

- Loading `/` after deployment does not throw from `createHomeIntegrations()` when current HTML is paired with either current integration JavaScript or the immediately preceding integration module.
- Current Bookmarks, Home Assistant, and Wake-on-LAN settings launchers remain visible and functional; removed widget-level controls do not reappear visually, in the tab order, or in the accessibility tree.
- Home HTML and JavaScript responses use a cache policy that prevents storing a stale cross-release module graph, while static serving retains correct content types, security headers, and path containment.
- Automated browser coverage fails on uncaught startup errors and verifies all current integration dialogs, instead of relying on a synthetic document that creates every selector automatically.
- Existing integration loading, controls, settings persistence, `/dashboard`, API behavior, and release behavior remain unchanged.
- Version `0.17.2`, test results, compatibility rationale, and any browser limitations are recorded accurately.

## Planning Verification

- Read the shared conventions and current command; inspected task numbering, Git status/history, the current and preceding integration module, current home markup, static server headers, Docker packaging, package versions, unit tests, and Playwright coverage.
- Confirmed the reported deployed line maps to the removed `#new-device` listener in the preceding release, and that three additional removed selectors would also fail if only the first null access were patched.
- This planning change adds only `tasks/32-prevent-stale-integration-crash/1-plan.md`; it does not modify implementation code.
