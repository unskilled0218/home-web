# goal

## command

- save weather location to server so uesr doesn't have to set location for every browser
- show current weather location on settings
- display weather updated time

1. save weather info temporarily to db.
  - server should retreive info constantly
2. display saved info first when load page
3. then load new info from background
4. display new info

## goal

Persist the selected weather location on the dashboard server so every browser uses the same saved location without repeating setup. Store its display label and validated coordinates in the existing SQLite database, and restore it after a server restart. The server-saved location must take precedence over browser-local location preferences. Selecting a location in Settings must save it to the server, report save failures clearly, and update the weather display after a successful save.

Show the current saved location in Settings → Weather whenever Settings opens, including in a fresh browser with no local preferences. Show a clear unconfigured state when no location is saved. Keep the existing location search and **Clear results** behavior: clearing search results preserves the saved location and displayed weather.

Move recurring weather retrieval to the server and persist the latest successful current conditions, hourly forecast, daily forecast, and air-quality data as a replaceable cache with update timestamps. Refresh on startup when a location is configured, after a location change, and periodically while the server runs, even when no browser is open. Use the existing hourly refresh cadence as the starting default. Keep requests bounded and prevent overlapping refreshes or late responses for an old location from replacing current data.

On page load, retrieve and render the database-cached weather before waiting for fresh provider data. Then refresh in the background and update the display when newer data becomes available. Browser polling or refresh requests must retrieve server-managed data without creating a separate provider refresh loop for each browser. Preserve the existing temperature, wind, precipitation, and timezone preferences, and ensure cached values match the requested presentation rather than showing another browser's units or another location's data.

Retain the latest successful data when a refresh fails, show its stale or failed-refresh state, and keep retrying on the server. Forecast and air-quality failures must remain independent so one successful result can still update. With no cached data, show a loading or unavailable state until the first successful retrieval. Keep the cache bounded to current useful weather snapshots rather than accumulating historical readings.

Display the last successful weather update time beside the weather information, formatted in the selected dashboard timezone. Use the persisted server retrieval timestamp for the displayed forecast, so cached data shows its original update time immediately on page load. Advance the displayed time only when a newer forecast is successfully retrieved; a failed refresh or an air-quality-only update must not make an older forecast appear fresh. Keep the timestamp visible with stale data, and show no successful update time before any forecast has been retrieved.

The current location and display preferences live in browser storage through `public/dashboard-helpers.js` and `public/dashboard.js`. `public/dashboard-weather.js` fetches Open-Meteo directly and refreshes hourly only while the browser is active; its stale data exists only in memory. Server persistence, API handling, and process lifecycle are in `src/db.js`, `src/app.js`, and `src/server.js`. These are the main integration points for shared location persistence and server-owned weather caching.

Completion means a fresh browser loads the server-saved location, Settings shows that location, cached weather renders with its saved update time before a delayed refresh finishes, and newer weather replaces it with a newer update time without clearing usable data. Verify persistence across restarts, periodic retrieval without connected browsers, location-change races, independent provider failures, update-time behavior for cached and failed refreshes, and unit/timezone correctness. Update the affected server, dashboard, browser checks, and weather documentation to describe the shared location, cached-first loading behavior, and displayed update time.
