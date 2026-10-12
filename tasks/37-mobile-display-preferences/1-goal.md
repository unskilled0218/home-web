# goal

## command

- mobile ui
  - from top
    - time
    - weather
    - calendar

- dedicated options for mobile
  - display/hide each view
  - scale

## goal

Give the photo dashboard a mobile layout that starts near the top of the page, below the page tools, and stacks its information in this order: time, weather, then calendar. When a view is hidden, the remaining views retain that order without reserving an empty section. Use the existing mobile breakpoint of viewport widths at or below 600px, and apply the correct layout automatically when the viewport changes through resizing or orientation changes.

Add clearly labeled mobile display options in Settings for the time, weather, and calendar views. Each view must have its own mobile show/hide toggle and mobile scale control, independently editable from its desktop controls. Mobile visibility and effective view sizing must use the mobile values rather than inherit desktop visibility, per-view scales, or the desktop overall scale. Keep the current desktop layout and display preferences working when the viewport is wider than the mobile breakpoint. Other preferences, such as timezone, weather units, calendar connection, and photo appearance, continue to apply across both layouts.

Save mobile display preferences through the existing **Save preferences** action and browser-local `dashboard.preferences.v1` storage. Restore them after reload, preserve drafts while switching Settings tabs, and validate mobile scales within the existing supported 0.5–2 range. Existing stored preferences without mobile fields must load with valid, documented mobile defaults while retaining their saved desktop values. Switching between mobile and desktop must change the active presentation without overwriting either set of preferences or requiring a reload.

Keep the clock, cached weather, forecast update time, and calendar information readable on narrow screens at supported scale values. Content must fit the available width without horizontal page scrolling or overlapping sections; vertical scrolling is allowed when the visible content exceeds the screen height. Settings controls must remain usable on mobile, including when a view is hidden. Applying mobile presentation must preserve weather location, cached data, and integration configuration, and must not introduce duplicate refresh timers or extra provider requests merely because the viewport crosses the breakpoint.

The current sections in `public/index.html` are calendar, time, and weather. `public/dashboard.css` bottom-aligns `#information` through `margin-top: auto` and changes some sizes at 600px without changing section order. `public/dashboard-helpers.js` normalizes one shared set of visibility and scale preferences, and `public/dashboard.js` applies those values directly to the views and service controllers. These files and the existing Settings controls are the main integration points for mobile order, top alignment, and separate mobile presentation settings.

Completion means mobile shows time above weather above calendar, with each mobile toggle and scale visibly affecting only its intended view. Verify saved mobile preferences after reload, missing or invalid mobile fields, independent desktop/mobile values, hidden-view ordering, and live transitions across the 600px breakpoint. Browser checks should cover 320px and 390px widths with populated weather and calendar data, supported scale extremes, and continued usability of Settings. Update the affected preference checks and dashboard documentation to explain the mobile options and defaults.
