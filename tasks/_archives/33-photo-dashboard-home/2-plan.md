# plan

## scope

Replace the widget home page with the existing photo dashboard at `/`, retire the widget-only frontend, and redirect old dashboard entry points to `/`. Preserve photo dashboard behavior, browser preferences, stored integration data, and existing backend APIs. Update affected tests and documentation.

## Implementation Plan

### 1. Make the photo dashboard the home document

- Replace `public/index.html` with the contents of `public/dashboard.html`, then remove the duplicate `public/dashboard.html` file.
- Remove the header's `Home` link. Keep the fullscreen and Settings buttons, accessible heading, status elements, weather forecasts, calendar, photo layers, and settings forms.
- Keep `/dashboard.css` and `/dashboard.js` asset names and their existing module imports. These are assets, not page routes, and renaming them adds unnecessary changes.
- Preserve `SETTINGS_KEY = 'dashboard.preferences.v1'` in `public/dashboard-helpers.js`. Keep localStorage defaults, normalization, and save-error handling. Existing preferences are origin-scoped and require no migration when moving the page path.
- Keep the photo and calendar API URLs, weather provider URLs, refresh lifecycles, and fullscreen behavior as implemented.

### 2. Redirect former dashboard entry points

- In `src/app.js`, retain `/` mapping to `/index.html` and replace the `/dashboard` and `/dashboard/` HTML aliases with explicit `308` redirects to `/`.
- Redirect `/dashboard.html` to `/` as well, preserving access to the former directly served HTML document after its removal.
- Send a fixed `Location: /`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`, then end the redirect response without loading a file. The dashboard does not use URL query parameters; redirect to the canonical root without forwarding them.
- Match only those three legacy paths. Do not redirect `/dashboard.js`, `/dashboard.css`, `/dashboard/missing`, or `/api/dashboard/photos`.
- Preserve path containment, static MIME types, existing cache headers, unknown-path handling, API Host/origin checks, and API dispatch order.

### 3. Remove only retired frontend dependencies

- Delete `public/app.js`, `public/app-helpers.js`, `public/styles.css`, `public/home-settings.js`, `public/home-widgets.js`, `public/home-information.js`, `public/home-integrations.js`, `public/home-shell.js`, and `public/home-responsive.js` after confirming no surviving runtime consumers require them.
- Retain `public/home-layout.js`. `src/home-settings.js` re-exports its defaults and normalization, and `src/db.js` uses those functions when loading saved settings. Removing it would break server startup and the retained `/api/home/settings` API.
- Retain `src/home-settings.js`, database tables and settings records, integration clients, credential encryption, and all integration APIs. Do not move the retired interface to another route or add replacement integration controls.
- Keep `public/dashboard*.js`, `public/dashboard.css`, and `public/weather-icons/`; the new home page uses them directly.
- Search surviving source, tests, configuration, and README for removed-file references. Historical task documents describe earlier implementations and need no rewriting.

### 4. Update server and unit regression coverage

- Replace the initial omnibus test in `test/dashboard.test.js` with separate named tests for home documents, legacy redirects, asset availability/headers, static containment, and existing presentation invariants. Use a small local server fixture with cleanup per test rather than introducing a generic test framework, so an early routing failure does not suppress unrelated checks.
- In the home-document test, verify `/` and `/index.html` serve the photo dashboard with correct content type, cache policy, and `nosniff`. Assert the photo dashboard module and key UI elements exist and the widget canvas, catalog, layout editor, legacy integration controls, and obsolete Home link do not.
- Test each legacy redirect using `fetch` with `redirect: 'manual'` so following redirects cannot conceal incorrect status or Location headers. Also verify normal navigation resolves to the same home document.
- Keep assertions for surviving dashboard assets and icons in the asset tests, forecast/calendar markup and existing CSS/module invariants in the presentation tests, and traversal/unknown-path cases in the containment test. Replace the deleted widget asset expectations with `404` checks for the retired assets. Point existing `/dashboard.html` content assertions at `/`.
- Remove the obsolete widget HTML test from `test/linkwarden-server.test.js` and remove imports used only by that test. Preserve its Linkwarden server integration coverage.
- Remove `test/home-settings.test.js`, `test/home-widgets.test.js`, `test/home-responsive.test.js`, `test/home-shell.test.js`, and `test/app-helpers.test.js`, which test deleted frontend modules.
- Retain `test/home-layout.test.js` and `test/home-settings-api.test.js` because their runtime dependencies and backend API remain. Preserve dashboard controller, photo API, calendar, integration, database, and security tests.

### 5. Replace browser checks with photo-dashboard behavior

- Replace `e2e/home-layout.spec.js` with `e2e/dashboard-home.spec.js`. Keep the existing isolated Playwright web server and database configuration.
- Check `/` initializes the clock, weather/calendar containers, Settings, and fullscreen control without page errors or requests for deleted assets or `/api/home/settings`.
- Check Settings opens and closes, save a visible preference such as information position or clock visibility, reload, and verify the preference persists under `dashboard.preferences.v1`.
- Seed nondefault preferences before the page module loads and verify `/` honors them. Visit each legacy page URL and verify the final URL is `/` with those same preferences.
- Check desktop and narrow mobile viewports can open Settings and use its controls without the old widget canvas appearing.
- Mock photo manifest/image, Open-Meteo, and calendar responses through Playwright routes for deterministic rendering checks. Verify a photo, current weather, hourly/daily forecasts, and a calendar event render at `/` without depending on live external services or an NFS mount.
- Cover the empty-photo/unconfigured-calendar defaults. Keep existing unit coverage for controller refresh timing, failed requests, and blocked/corrupt storage instead of duplicating it in browser tests.
- Exercise fullscreen enter/exit when supported; otherwise verify the existing unavailable state. Record any browser-environment limitation.

### 6. Update instructions and verify the implementation

- In `README.md`, replace the Home widgets section with the root photo dashboard instructions and consolidate the existing Photo dashboard section. Document `/` as the primary URL and the legacy redirects.
- Correct the Run locally introduction, NFS reload URL, calendar connection instructions, and browser-local preference description. Remove widget layout migration/editing instructions and obsolete navigation directions for Bookmarks settings, Home Assistant settings, and Wake-on-LAN controls.
- Describe retained Home Assistant, Linkwarden, and Wake-on-LAN capabilities as backend integrations without a dashboard interface. Preserve useful API, TLS, configuration, deployment, and backup details.
- Run `npm test`, `npm run check`, and `npm run test:browser`. If Chromium is missing, ask the user to install it and record the blocked browser verification rather than claiming it passed.
- Inspect the final diff for unintended backend/data changes, dangling imports, and references to removed UI controls. Record implementation results and actual verification outcomes in `4-implemented.md` under this task when implementation is complete.

## Acceptance Criteria

- `/` and `/index.html` render the existing photo dashboard with its clock, weather forecasts, optional calendar, backgrounds, Settings, and fullscreen control.
- `/dashboard`, `/dashboard/`, and `/dashboard.html` return `308` with `Location: /`; following them loads the home dashboard without a loop.
- The widget canvas, catalog, layout editing, widget settings, hidden legacy controls, and obsolete Home link are absent. Deleted frontend assets are no longer served or requested.
- Existing `dashboard.preferences.v1` values load at `/`; new preference saves survive reloads on the same origin.
- The server still loads existing settings and credentials. The retained integration and home settings APIs pass their existing tests without database deletion or migration.
- Photo, weather, calendar, and static containment regression checks remain green. Updated browser checks exercise the replacement home page on desktop and mobile.
- README instructions match the new entry point and available interface. All three verification commands pass, or an environment blocker is explicitly recorded.

## Risks And Decisions

- `public/home-layout.js` is shared with the server despite its frontend location. Retain it and its tests; relocating or simplifying the backend settings model is outside this task.
- Removing the widget interface also removes browser controls for Wake-on-LAN, Linkwarden, and Home Assistant. Their stored data and APIs remain available; adding another management page would expand the goal.
- Browser preferences remain local to the same origin. Changing host, protocol, or port would select different storage and is not part of this route change.
- Keep dashboard asset and photo API names to avoid needless controller changes. Redirect the old HTML URLs instead of keeping duplicate pages.
- Remove tests only for retired frontend behavior. Keep backend and shared-controller coverage so cleanup cannot hide integration regressions.
- Weather, NFS, and Baikal may be unavailable during verification. Use deterministic browser fixtures and existing isolated backend tests rather than live services.
