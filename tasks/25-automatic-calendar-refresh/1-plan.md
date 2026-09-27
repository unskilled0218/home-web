# Task 25: Use Automatic Calendar Refresh Only

## Objective

Remove the dashboard calendar's manual Refresh button and rely on its automatic refresh lifecycle to keep events current while the calendar is configured, enabled, and visible.

## Request and Scope

- Request from `~/workdir/command.md`: automatically refresh the calendar and remove the refresh button.
- Preserve the existing five-minute automatic refresh cadence, immediate initial event load, immediate refresh after returning from a hidden/disabled state, and refresh after a successful calendar connection.
- Remove only the browser's explicit calendar refresh control and cache-bypass action. Keep calendar connect/disconnect controls in Settings.
- Preserve server-side CalDAV caching, refresh-time discovery, stale snapshot behavior, authentication/authorization handling, event formatting, timezone behavior, and all non-calendar dashboard features.
- Do not add continuous polling while the page is hidden or while the calendar display is disabled.

## Inspected Context

- `public/dashboard-calendar.js` already sets `REFRESH_MS` to five minutes, schedules one owned timer after successful or failed event requests, and refreshes only while visible, calendar-visible, configured, authenticated, and authorized.
- Controller startup fetches `/api/calendar` and then `/api/calendar/events` immediately when configured. Returning from page/calendar invisibility also triggers an immediate refresh before restarting the timer.
- Transient event failures retain the last successful snapshot, mark it stale, and schedule another automatic attempt. HTTP 401/403 clears private events and stops retries until reconnect/authorization recovery.
- `public/dashboard.html` renders a `.calendar-heading` wrapper containing only `<button id="refresh-calendar">Refresh</button>` because the visible Calendar heading was removed in commit `4a4cbd1`.
- `public/dashboard.js` disables that button based on state and binds it to `calendar.forceRefresh()`. No other production caller uses `forceRefresh()`; page restoration already calls normal `calendar.refresh()`.
- `public/dashboard.css` retains `.calendar-heading`, heading, button, and right-alignment rules that become dead after the wrapper/button is removed.
- `test/dashboard-calendar.test.js` verifies timer ownership and visibility pause/resume, but it only checks that a five-minute task exists; it does not execute the scheduled callback to prove an automatic event request occurs. Several unrelated scenarios call `forceRefresh()` as a convenient test trigger.
- `test/dashboard.test.js` serves and inspects the dashboard assets but does not currently require the Refresh button or its listener to be absent.
- `README.md` correctly says the browser refreshes every five minutes while visible but also says it supports an explicit refresh, which will become inaccurate.
- The project is version `0.15.1`, uses native browser modules and `node:test`, and has no frontend build step.

## Behavioral Decisions

- Five minutes remains the refresh interval. This matches `CALDAV_CACHE_SECONDS=300`, avoids unnecessary CalDAV traffic, and requires no new preference or environment setting.
- Automatic refresh uses the normal `/api/calendar/events` request. Do not append `?refresh=1`; the server cache naturally expires at the same cadence and continues to centralize upstream request deduplication and stale fallback.
- Keep one timer owned by the controller. Each completed request replaces the prior timer; repeated configure/render calls must not accumulate pollers.
- Pause and cancel event work while `document.hidden` is true or calendar display is disabled. On resume, refresh immediately, then schedule the next five-minute run from completion.
- Continue scheduling after transient failures so recovery is automatic. Stop scheduling for unconfigured, reauthentication-required, access-denied, disabled, hidden, or disposed states.
- Remove `forceRefresh()` from the browser controller API and simplify `refresh(force)` to `refresh()` because there will be no explicit cache-bypass caller.
- Keep the server's existing `?refresh=1` API support out of scope; removing an internal UI control does not require changing server behavior or existing API tests.

## Implementation Plan

### 1. Remove the manual calendar control

- Delete the `.calendar-heading` wrapper and `#refresh-calendar` button from `public/dashboard.html`, leaving calendar status and event list as the section's visible content.
- Remove button-state updates from `renderCalendar()` and remove the click listener from `public/dashboard.js`.
- Remove now-unused `.calendar-heading`, `.calendar-heading h2`, `.calendar-heading button`, and right-aligned heading rules from `public/dashboard.css` without changing event-list alignment.
- Confirm no `refresh-calendar` references remain in shipped browser assets.

### 2. Make the controller API automatic-only

- Change the calendar controller's event refresh function to have no force argument and always request `/api/calendar/events` through the normal cache-aware path.
- Remove the force-specific pending-request branch and `?refresh=1` suffix generation while retaining ordinary in-flight request deduplication.
- Remove `forceRefresh()` from the returned controller API. Keep `refresh()` for controller-owned timer, visibility resume, page restoration, and tests.
- Preserve generation invalidation, abort handling, timer replacement, status loading, connect/disconnect mutation ordering, and stale-response suppression.

### 3. Strengthen automatic-refresh tests

- Update `test/dashboard-calendar.test.js` scenarios that manually call `forceRefresh()` to call normal `refresh()` when they need to trigger an event request.
- Extend the scheduler test seam or directly execute its captured five-minute callback, then assert that it issues `/api/calendar/events`, publishes the response, and installs exactly one next timer.
- Assert the automatic request does not use `?refresh=1` and concurrent normal refresh calls remain deduplicated.
- Retain coverage for immediate startup, hidden/disabled pause, immediate resume, transient stale fallback and retry, 401/403 retry suppression, connect/disconnect, cancellation, and disposal.
- Extend `test/dashboard.test.js` static checks to require that `refresh-calendar`, the Refresh button copy, the button listener, `forceRefresh`, and obsolete heading CSS are absent while the calendar status/list remain present.

### 4. Update documentation and release metadata

- Update the README calendar behavior to say events refresh automatically every five minutes while visible and immediately after visibility/calendar-display resume; remove the explicit-refresh claim.
- Keep the documented cache duration and refresh-time discovery behavior aligned with the unchanged server implementation.
- Bump `package.json` from `0.15.1` to `0.15.2` for the focused user-visible control/lifecycle change.
- Write `tasks/25-automatic-calendar-refresh/3-implemented.md` before the implementation commit with changed files, final lifecycle behavior, verification evidence, browser availability, and any departures from this plan.

## Verification

Run from the repository root:

```bash
node --test test/dashboard-calendar.test.js
node --test test/dashboard.test.js
npm test
npm run check
git diff --check
```

Also verify manually in a browser when available:

1. Open `/dashboard` with a configured calendar and confirm events load immediately without a Refresh button.
2. Leave the visible calendar open through a five-minute boundary and confirm events update automatically without duplicate requests or visible control state.
3. Hide/show the tab and disable/re-enable calendar visibility; confirm polling pauses while inactive and one immediate refresh occurs on resume.
4. Simulate a temporary CalDAV outage, confirm retained events are marked stale, restore service, and confirm a later automatic attempt clears the stale state.
5. Confirm authentication and authorization failures clear private events and do not retry every five minutes.
6. Confirm connect/disconnect settings, clock, weather, photo slideshow, fullscreen, Home Assistant, Linkwarden, and Wake-on-LAN behavior remain unchanged.

## Acceptance Criteria

- The dashboard calendar has no manual Refresh button or associated browser event listener.
- A configured, visible, enabled calendar loads immediately and automatically refreshes every five minutes with one owned timer.
- Automatic refresh pauses while hidden or disabled, resumes immediately when active again, and continues retrying transient failures without discarding the last successful snapshot.
- Authentication/authorization failures and disconnect stop automatic requests and clear private browser snapshots as before.
- The browser controller no longer exposes or uses a force-refresh path; automatic requests remain cache-aware.
- README, tests, implementation record, and version `0.15.2` accurately describe the shipped behavior.
- Focused and full automated checks pass, and browser-only verification is reported accurately.

## Planning Verification

- Inspected task numbering, current calendar markup/render integration, controller timer and visibility lifecycle, stale/auth failure behavior, CSS, browser-controller tests, static dashboard tests, README guidance, package version, and recent user UI commits.
- Confirmed automatic five-minute refresh already exists, so the implementation should remove the redundant manual path and prove the automatic callback rather than introduce a second polling mechanism.
- This planning task adds only `tasks/25-automatic-calendar-refresh/1-plan.md`; implementation code remains unchanged.
