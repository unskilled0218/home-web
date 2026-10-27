# Implemented

- [Implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Environment blocker](#environment-blocker)
  - [Decisions and remaining verification](#decisions-and-remaining-verification)

## Changes

- Implemented on the new branch `77-image-visibility`.
- Added the saved `imageVisible` boolean, defaulting to `true`, and the accessible **Images → Show image** checkbox. The existing category form and Save action own persistence, drafts, and Local/Global scope.
- Extended the pure display projection to hide the whole photo container and filename caption. Caption-only automatic layout space disappears while hidden; Custom caption reparenting preserves the projected visibility. Widgets and saved geometry remain unchanged.
- Added absent-field upgrades for server records, Local records, confirmed browser caches, and version-1 settings transfers. Explicit `false` remains intact; malformed values and incomplete current writes remain rejected. Renamed the existing scale-only compatibility helper to `decodeAdditivePreferences` and updated all callers to reflect its expanded purpose.
- Left photo controllers, source ownership, NFS configuration, preloading, rotation, and document-visibility lifecycle unchanged. Hidden photos continue playback and showing them reveals the current selection.
- Added preference, migration, cache, API, transfer, category-scope, display, and layout regression coverage. Added nine browser scenarios covering save/discard, reload, three playback modes, browser isolation, Global propagation, desktop/mobile/fullscreen, Custom geometry, delayed completion, and active transitions.
- Updated README and relevant dashboard/scope/transfer documentation. Advanced the patch version from `0.17.45` to `0.17.46`, including `VERSION`, package manifests, release configuration, current release link, and new versioned release notes. No release was published.
- Left the pre-existing `todo.md` change untouched and excluded it from the implementation commit.

## Verification

- `npm run check`: passed on version `0.17.46` using Node.js `v24.22.1`.
- `node --check e2e/image-visibility.spec.js`: passed. The normal syntax checker does not include browser specs, so this file was checked separately.
- `node --test test/dashboard-image-visibility.test.js test/dashboard-display.test.js test/dashboard-layout-view.test.js test/dashboard-settings-categories.test.js test/dashboard-widget-scales.test.js`: passed, 29 tests, zero failures.
- `bash scripts/release.sh --validate`: passed; configuration and synchronized version metadata are valid. No credentials or remote operations were used.
- `git diff --check`: passed before recording this report.
- `npm test`: failed, 483 reported tests, 323 passed and 160 failed, with zero skips. Numerous HTTP, WebSocket, integration, and startup failures stem from the Node runtime blocker below. This is not a passing full-suite result. Output: `/tmp/opencode/77-image-visibility-node-tests.log`.
- `npm run test:browser`: failed before browser tests could start. Playwright initialization hits the same Node built-in Undici syntax error. None of the nine new browser scenarios has been executed successfully. Output: `/tmp/opencode/77-image-visibility-browser-tests.log`.

## Environment blocker

The installed Node.js runtime fails independently of project code. Running `node -e 'console.log(Response.json({ok:true}).status)'` throws `SyntaxError: Unexpected token 'var'` from `node:internal/deps/undici/undici:17394`; the displayed built-in source contains malformed characters. Trying `--no-node-snapshot` also fails with `SyntaxError: Invalid or unexpected token` in that built-in module. Playwright encounters the same failure while loading its dependencies.

No system packages were installed, no Node binary was modified, and no dependency or production workaround was added. A working Node.js 24-or-newer installation is required before HTTP-dependent and browser verification can be trusted.

## Decisions and remaining verification

The implementation follows the approved presentation-only design. No layout-view production change was necessary because that module reparents captions without changing their `hidden` state; regression tests cover that boundary. No database migration or transfer schema-version change was needed.

After repairing Node.js, first rerun `node -e 'console.log(Response.json({ok:true}).status)'` and confirm it prints `200`. Then run `npm test` and `npm run test:browser` on this branch. The feature is implemented, but full integration/browser acceptance remains unverified until those checks pass.
