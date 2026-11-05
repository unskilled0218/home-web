import { dashboardDisplay } from './dashboard-display.js';

const visibilityKeys = Object.freeze({ time: 'timeVisible', weather: 'weatherVisible', calendar: 'calendarVisible', bookmarks: 'bookmarksVisible', 'home-assistant': 'homeAssistantVisible', wol: 'wolVisible' });

// Eligibility follows the profile being edited, not the live viewport's DOM state.
export function visibleLayoutWidgets(preferences, mode, fullscreen = false) {
  const display = dashboardDisplay(preferences, { mobile: mode === 'mobile', fullscreen });
  return Object.keys(visibilityKeys).filter(id => display[visibilityKeys[id]]);
}
