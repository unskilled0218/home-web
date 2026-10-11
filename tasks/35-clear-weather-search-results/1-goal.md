# goal

## command

- weather location `clear location` button should not reset weather location. just clear search results

## goal

Change the weather location clear action in Settings → Weather so it removes the search result list without resetting the selected weather location. Keep the selected location, its saved `dashboard.preferences.v1` value, and the current weather display intact. Clearing results must not save preferences, reapply dashboard settings, or trigger a weather refresh.

Cancel any pending location search and invalidate its response so results cannot reappear after the user clears them. Update the button label and search status to describe clearing search results rather than deleting the location. Preserve the search query and any unsaved display preferences; the action only clears search results and their related status.

Selecting a search result must continue to select and save that location as before. The action must also work when no location is selected or no results are present, without creating or changing a location.

The current handler in `public/dashboard.js` sets `settings.location` to `null`, saves, and reapplies settings. The button is in `public/index.html`; `e2e/dashboard-home.spec.js` and the README currently describe the location-reset behavior. Completion means clearing results leaves the selected location and persisted preferences unchanged, keeps weather information visible, and prevents late search responses from restoring the cleared list. Update the affected checks and instructions to match the results-only behavior.
