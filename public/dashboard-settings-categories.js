import { validateDashboardPreferences } from './dashboard-helpers.js';

export const SETTINGS_CATEGORIES = Object.freeze({
  general: { label: 'General', keys: ['position', 'scale', 'widgetLayout'] },
  time: { label: 'Time', keys: ['timezone', 'dateStyle', 'hour12', 'seconds', 'timeVisible', 'timeScale', 'mobileTimeVisible', 'mobileTimeScale', 'hideTimeFullscreen'] },
  weather: { label: 'Weather', keys: ['temperature', 'wind', 'precipitation', 'weatherHourlyVisible', 'weatherDailyVisible', 'weatherVisible', 'weatherScale', 'mobileWeatherVisible', 'mobileWeatherScale', 'hideWeatherFullscreen'] },
  calendar: { label: 'Calendar', keys: ['calendarVisible', 'calendarScale', 'mobileCalendarVisible', 'mobileCalendarScale', 'hideCalendarFullscreen'] },
  bookmarks: { label: 'Bookmarks', keys: ['bookmarksVisible', 'bookmarksScale', 'mobileBookmarksVisible', 'mobileBookmarksScale', 'hideBookmarksFullscreen', 'mobileBookmarksMode', 'bookmarkLinkSelections'] },
  'home-assistant': { label: 'Home Assistant', keys: ['homeAssistantVisible', 'homeAssistantScale', 'mobileHomeAssistantVisible', 'mobileHomeAssistantScale', 'hideHomeAssistantFullscreen', 'homeAssistantDeviceSelections'] },
  wol: { label: 'Wake-on-LAN', keys: ['wolVisible', 'wolScale', 'mobileWolVisible', 'mobileWolScale', 'hideWolFullscreen'] },
  images: { label: 'Images', keys: ['imageVisible', 'order', 'interval', 'duration', 'animation', 'opacity', 'background', 'color', 'blur', 'imageInfo'] }
});
export const CATEGORY_IDS = Object.freeze(Object.keys(SETTINGS_CATEGORIES));
export function settingsCategory(id) {
  if (!Object.hasOwn(SETTINGS_CATEGORIES, id)) throw new Error('Unknown settings category.');
  return SETTINGS_CATEGORIES[id];
}
export const categoryScopes = (mode = 'local') => Object.fromEntries(CATEGORY_IDS.map(id => [id, mode]));
export function categoryPreferences(id, preferences) { return Object.fromEntries(settingsCategory(id).keys.map(key => [key, structuredClone(preferences[key])])); }
export function patchCategory(id, preferences, patch) {
  const { keys } = settingsCategory(id);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !keys.includes(key))) throw new Error('Invalid category preference fields.');
  return validateDashboardPreferences({ ...preferences, ...patch });
}
export function composeCategoryPreferences(scopes, local, global) {
  return validateDashboardPreferences(Object.assign({}, ...CATEGORY_IDS.map(id => categoryPreferences(id, scopes[id] === 'global' ? global : local))));
}
