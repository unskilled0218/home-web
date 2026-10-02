# Task 32: Prevent Stale Integration Startup Crashes - Implementation

## Reproduction

- The deployed stack line maps to the preceding release's `document.querySelector('#new-device').addEventListener(...)` initialization.
- Current HTML removed `#new-device`, `#search`, `#wake-selected`, and `#home-assistant-settings` while the preceding integration module requires all four, so mixed-release static assets abort initialization.

## Changes

- Added a hidden, inert compatibility container to `public/index.html` with the four controls required by the immediately preceding integration module: `#new-device`, `#search`, `#wake-selected`, and `#home-assistant-settings`. The current UI remains unchanged, and the comment records removal after v0.17.2 has displaced cached v0.17.1 assets.
- Changed static HTML and JavaScript responses to `Cache-Control: no-store` so browsers and intermediaries do not retain a module graph across deployments. CSS, SVG, and other independent static assets retain `no-cache`; MIME, containment, and security-header handling are unchanged.
- Extended `test/dashboard.test.js` to verify home integration selector uniqueness, the hidden compatibility contract, HTML/JavaScript cache policy, CSS cache policy, content types, and `X-Content-Type-Options`.
- Added Playwright coverage that captures uncaught `pageerror` events, exercises the preceding release's four startup selector operations against current markup, and opens/closes the current Bookmarks, Home Assistant, and Wake-on-LAN settings dialogs.
- Updated `package.json` and `package-lock.json` from `0.17.1` to `0.17.2`.
- No README change was needed because it makes no conflicting static-cache claim.

## Verification

- `node --test test/dashboard.test.js test/home-widgets.test.js`: passed, 28 tests.
- `npm test`: passed, 169 tests.
- `npm run check`: passed.
- `npm run test:browser`: passed, 4 Chromium tests at desktop, 320px mobile, and 390px mobile sizes.
- `git diff --check`: passed.
- Native Chromium verification confirmed no startup page errors, the compatibility controls remain hidden, and all three current integration dialogs open and close successfully.
