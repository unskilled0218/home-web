# Task 25: Automatic Calendar Refresh Implementation

## Result

Removed the dashboard calendar's manual Refresh button and force-refresh browser path. A configured calendar continues to load immediately, refresh automatically every five minutes while visible and enabled, refresh immediately after becoming active again, and retry transient failures while retaining a stale snapshot.

## Changes

- Removed the `refresh-calendar` button and its now-empty heading wrapper from `public/dashboard.html`.
- Removed manual button state and click-listener handling from `public/dashboard.js`.
- Removed obsolete calendar-heading and button selectors from `public/dashboard.css`.
- Simplified `public/dashboard-calendar.js` from `refresh(force)` to cache-aware `refresh()` and removed query-string cache bypass generation.
- Removed `forceRefresh()` from the calendar controller's public browser API.
- Preserved the existing five-minute timer, one-request deduplication, visible/enabled gating, immediate startup/resume behavior, transient stale fallback, authentication/authorization retry suppression, cancellation, and disposal behavior.
- Updated README calendar guidance to describe automatic five-minute refresh, inactive pause, and immediate resume without claiming an explicit refresh control.
- Bumped the project version from `0.15.1` to `0.15.2`.

## Tests

- Extended the timer test to execute the captured five-minute callback, verify a normal `/api/calendar/events` request, and confirm exactly one replacement timer is owned afterward.
- Replaced force-refresh test triggers with normal refresh and verified resume requests remain cache-aware.
- Added an assertion that transient event failure retains one automatic retry timer.
- Added static checks that dashboard HTML, JavaScript, calendar-controller JavaScript, and CSS contain no manual calendar refresh control, listener, force API, cache-bypass query, or obsolete heading styles.
- Updated two existing dashboard expectations to match the user's already-committed seven-hour sampling and `70%` forecast-width preferences; implementation behavior was not changed for those features.

## Verification

Passed:

```text
node --test test/dashboard-calendar.test.js test/dashboard.test.js
25 tests passed, 0 failed

npm test
129 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

Browser and live CalDAV checks were unavailable in this environment, so a real five-minute visible session, tab visibility transitions, and upstream outage/recovery were not claimed as manually verified.

## Departures from Plan

- None. Server support for `?refresh=1` remains unchanged and covered by API tests; only the browser's manual force-refresh path was removed.
